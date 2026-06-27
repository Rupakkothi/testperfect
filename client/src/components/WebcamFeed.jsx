import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function WebcamFeed({ onAudioAlert, onStatusChange }) {
  const videoRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  
  // Use refs for callbacks to avoid re-running the entire media setup on parent re-renders
  const onAudioAlertRef = useRef(onAudioAlert);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onAudioAlertRef.current = onAudioAlert; }, [onAudioAlert]);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  const [streamActive, setStreamActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [volume, setVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isCancelled = false;
    let animationFrameId;
    let activeVideoStream = null;
    let activeAudioStream = null;

    const resumeCtx = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(e => console.warn("Failed to resume AudioContext:", e));
      }
    };

    window.addEventListener('click', resumeCtx);
    window.addEventListener('keydown', resumeCtx);

    async function setupMedia() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg("Media devices API is blocked/unavailable (requires secure HTTPS context).");
        if (onStatusChangeRef.current) {
          onStatusChangeRef.current({ camera: false, mic: false });
        }
        return;
      }

      let cameraOk = false;
      let micOk = false;
      let detailedErrors = [];

      // 1. Setup Camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }
        });
        if (isCancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        activeVideoStream = stream;
        streamRef.current = stream;
        cameraOk = true;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Ensure playback starts
          videoRef.current.play().catch(e => console.warn("Video autoplay blocked:", e));
        }
        setStreamActive(true);

        stream.getVideoTracks().forEach(track => {
          track.addEventListener('ended', () => {
            if (isCancelled) return;
            setStreamActive(false);
            if (onStatusChangeRef.current) onStatusChangeRef.current({ camera: false, mic: micOk });
          });
        });
      } catch (err) {
        console.error("Error accessing camera:", err.name, err.message);
        cameraOk = false;
        if (err.name === 'NotAllowedError') {
          detailedErrors.push("Camera permission denied — please allow camera access in your browser settings");
        } else if (err.name === 'NotFoundError') {
          detailedErrors.push("No camera found — please connect a webcam");
        } else if (err.name === 'NotReadableError') {
          detailedErrors.push("Camera is in use by another application");
        } else {
          detailedErrors.push(`Webcam error: ${err.message}`);
        }
      }

      if (isCancelled) return;

      // 2. Setup Mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        if (isCancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        activeAudioStream = stream;
        micOk = true;
        setMicActive(true);

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        // Immediately try to resume in case it starts suspended
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
        
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        let loudStart = null;
        let lastImmediateAlert = 0;
        const checkVolume = () => {
          if (isCancelled || !analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const normVolume = Math.min(Math.round((average / 128) * 100), 100);
          setVolume(normVolume);

          // Immediate threshold check: if sound volume increases to 70% or more, log violation immediately
          if (normVolume >= 70) {
            const now = Date.now();
            if (now - lastImmediateAlert > 5000) {
              lastImmediateAlert = now;
              if (onAudioAlertRef.current) {
                onAudioAlertRef.current(`Critical noise violation: Volume spiked to ${normVolume}%`);
              }
            }
          }

          // Sustained noise threshold check (> 25% for 3 seconds)
          if (normVolume > 25) {
            if (!loudStart) {
              loudStart = Date.now();
            } else if (Date.now() - loudStart > 3000) {
              if (onAudioAlertRef.current) onAudioAlertRef.current(`Suspicious sustained noise detected (${normVolume}%)`);
              loudStart = null;
            }
          } else {
            loudStart = null;
          }

          animationFrameId = requestAnimationFrame(checkVolume);
        };

        checkVolume();

        stream.getAudioTracks().forEach(track => {
          track.addEventListener('ended', () => {
            if (isCancelled) return;
            setMicActive(false);
            if (onStatusChangeRef.current) onStatusChangeRef.current({ camera: cameraOk, mic: false });
          });
        });
      } catch (err) {
        console.error("Error accessing microphone:", err.name, err.message);
        micOk = false;
        if (err.name === 'NotAllowedError') {
          detailedErrors.push("Microphone permission denied — please allow mic access in your browser settings");
        } else if (err.name === 'NotFoundError') {
          detailedErrors.push("No microphone found — please connect a microphone");
        } else if (err.name === 'NotReadableError') {
          detailedErrors.push("Microphone is in use by another application");
        } else {
          detailedErrors.push(`Microphone error: ${err.message}`);
        }
      }

      if (isCancelled) return;

      if (onStatusChangeRef.current) {
        onStatusChangeRef.current({ camera: cameraOk, mic: micOk });
      }

      if (!cameraOk || !micOk) {
        setErrorMsg(`Failed to start: ${detailedErrors.join(" & ")}. Please verify permissions/connection.`);
      } else {
        setErrorMsg('');
      }
    }

    setupMedia();

    return () => {
      isCancelled = true;
      window.removeEventListener('click', resumeCtx);
      window.removeEventListener('keydown', resumeCtx);
      if (activeVideoStream) {
        activeVideoStream.getTracks().forEach(track => track.stop());
      }
      if (activeAudioStream) {
        activeAudioStream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(e => {});
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [retryCount]); // Only re-run on explicit retry, not on callback changes

  return (
    <div className="proctor-sidebar">
      <div className="webcam-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="webcam-video"
          style={{ display: streamActive ? 'block' : 'none' }}
        />
        {!streamActive && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {errorMsg ? errorMsg : "Requesting camera stream..."}
          </div>
        )}
        <div className={`webcam-badge ${streamActive ? 'active' : ''}`}>
          {streamActive ? "PROCTORING ACTIVE" : "CAMERA OFF"}
        </div>
      </div>

      <div className="volume-meter-wrapper">
        <div className="volume-meter-label">
          <span>Microphone Input</span>
          <span>{micActive ? `${volume}%` : 'Muted'}</span>
        </div>
        <div className="volume-bar-bg">
          <div 
            className="volume-bar-fg" 
            style={{ width: micActive ? `${volume}%` : '0%' }}
          />
        </div>
      </div>
    </div>
  );
}
