import React, { useEffect, useRef, useState } from 'react';

export default function WebcamFeed({ onAudioAlert, onStatusChange }) {
  const videoRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  
  const [streamActive, setStreamActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [volume, setVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let isCancelled = false;
    let animationFrameId;
    let activeVideoStream = null;
    let activeAudioStream = null;

    async function setupMedia() {
      let cameraOk = false;
      let micOk = false;
      let detailedErrors = [];

      // 1. Setup Camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 }
        });
        if (isCancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        activeVideoStream = stream;
        cameraOk = true;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStreamActive(true);

        stream.getVideoTracks().forEach(track => {
          track.addEventListener('ended', () => {
            if (isCancelled) return;
            setStreamActive(false);
            if (onStatusChange) onStatusChange({ camera: false, mic: micOk });
          });
        });
      } catch (err) {
        console.error("Error accessing camera:", err);
        cameraOk = false;
        detailedErrors.push("Webcam denied/unavailable");
      }

      if (isCancelled) return;

      // 2. Setup Mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true
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
        
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        let loudStart = null;
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

          if (normVolume > 25) {
            if (!loudStart) {
              loudStart = Date.now();
            } else if (Date.now() - loudStart > 3000) {
              if (onAudioAlert) onAudioAlert(`Suspicious noise detected (${normVolume}%)`);
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
            if (onStatusChange) onStatusChange({ camera: cameraOk, mic: false });
          });
        });
      } catch (err) {
        console.error("Error accessing microphone:", err);
        micOk = false;
        detailedErrors.push("Microphone denied/unavailable");
      }

      if (isCancelled) return;

      if (onStatusChange) {
        onStatusChange({ camera: cameraOk, mic: micOk });
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
      if (activeVideoStream) {
        activeVideoStream.getTracks().forEach(track => track.stop());
      }
      if (activeAudioStream) {
        activeAudioStream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [onAudioAlert, onStatusChange]);

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
