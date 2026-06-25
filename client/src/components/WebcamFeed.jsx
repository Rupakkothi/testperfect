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
    let animationFrameId;

    async function setupMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: true
        });

        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setStreamActive(true);
          if (onStatusChange) onStatusChange({ camera: true, mic: true });
        }

        // Setup Web Audio API for volume levels
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        setMicActive(true);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Check audio levels periodically
        let silenceStart = null;
        let loudStart = null;

        const checkVolume = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Calculate average volume level
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Normalize volume (0 to 100)
          const normVolume = Math.min(Math.round((average / 128) * 100), 100);
          setVolume(normVolume);

          // Threshold for audio alert (e.g. speaking/noise > 25%)
          if (normVolume > 25) {
            if (!loudStart) {
              loudStart = Date.now();
            } else if (Date.now() - loudStart > 3000) { // Loud noise for > 3 seconds
              if (onAudioAlert) {
                onAudioAlert(`Suspicious noise detected (${normVolume}%)`);
              }
              loudStart = null; // reset alert trigger
            }
          } else {
            loudStart = null;
          }

          animationFrameId = requestAnimationFrame(checkVolume);
        };

        checkVolume();

      } catch (err) {
        console.error("Error accessing webcam/mic:", err);
        setErrorMsg("Failed to start Camera/Mic. Please allow access in browser permissions.");
        if (onStatusChange) onStatusChange({ camera: false, mic: false });
      }
    }

    setupMedia();

    return () => {
      // Clean up streams and audio context
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
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
