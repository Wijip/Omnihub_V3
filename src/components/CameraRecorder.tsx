import React, { useState, useRef } from 'react';

interface CameraRecorderProps {
  onRecordingComplete: (file: File) => void;
}

const CameraRecorder: React.FC<CameraRecorderProps> = ({ onRecordingComplete }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Hotfix Tahap 40.1: Mengikat stream secara aman setelah elemen <video> lahir di DOM
  React.useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Efek otomatis: Restart kamera jika user mengubah pengaturan saat kamera menyala (dan tidak sedang merekam)
  React.useEffect(() => {
    if (stream && !isRecording && devices.length > 0) {
      stopCamera();
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId, resolution]);

  const startCamera = async () => {
    try {
      let currentDeviceId = selectedDeviceId;

      // Request initial permission to unlock labels
      if (devices.length === 0) {
        const initialStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        setDevices(videoDevices);

        if (videoDevices.length > 0) {
          const smartDefault = videoDevices.find(d => {
            const label = d.label.toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('utama');
          });
          currentDeviceId = smartDefault ? smartDefault.deviceId : videoDevices[0].deviceId;
          setSelectedDeviceId(currentDeviceId);
        }

        initialStream.getTracks().forEach(track => track.stop());
      }

      const videoConstraints: any = {
        width: resolution === '1080p' ? { ideal: 1920, min: 1280 } : { ideal: 1280, min: 720 },
        height: resolution === '1080p' ? { ideal: 1080, min: 720 } : { ideal: 720, min: 480 },
        frameRate: { ideal: 30 }
      };

      if (currentDeviceId) {
        videoConstraints.deviceId = { exact: currentDeviceId };
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: videoConstraints, 
        audio: true 
      });
      setStream(mediaStream);
    } catch (err) {
      console.error("Gagal mengakses kamera/mikrofon dengan opsi ini:", err);
      alert("Gagal memuat kamera. Perangkat mungkin tidak mendukung resolusi atau mode kamera ini.");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const startRecording = () => {
    if (!stream) return;
    chunksRef.current = [];
    // Booster Bitrate (Tahap 40.3): Mengunci kualitas video agar tidak pecah/kabur sebelum dikirim
    const targetBitrate = resolution === '1080p' ? 8000000 : 4000000; // 8 Mbps atau 4 Mbps
    
    let options: MediaRecorderOptions = { videoBitsPerSecond: targetBitrate };
    if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
      options.mimeType = 'video/webm; codecs=vp9';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
      options.mimeType = 'video/webm; codecs=vp8';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      options.mimeType = 'video/mp4';
    } else {
      options.mimeType = 'video/webm';
    }
    
    const mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/mp4' });
      const file = new File([blob], `Camera_Record_${Date.now()}.mp4`, { type: 'video/mp4' });
      onRecordingComplete(file);
      stopCamera();
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const selectedDevice = devices.find(d => d.deviceId === selectedDeviceId);
  const isFrontCamera = selectedDevice ? (selectedDevice.label.toLowerCase().includes('front') || selectedDevice.label.toLowerCase().includes('depan')) : true;

  return (
    <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700 mb-6">
      <h3 className="text-xl font-bold text-white mb-4">📹 Perekam Kamera Studio Langsung</h3>
      
      {!stream ? (
        <button 
          onClick={startCamera}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-medium transition-colors"
        >
          Aktifkan Kamera Device
        </button>
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-md bg-black rounded-lg overflow-hidden border border-neutral-600">
            {/* Fix Tahap 40.4: Mengunci efek cermin hanya untuk kamera depan */}
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              playsInline
              style={{ transform: isFrontCamera ? 'scaleX(-1)' : 'scaleX(1)' }}
              className="w-full h-auto aspect-video object-cover bg-black rounded-lg" 
            />
            {isRecording && (
              <div className="absolute top-3 left-3 flex items-center space-x-2 bg-red-600/80 px-3 py-1 rounded-full text-xs text-white font-bold animate-pulse">
                <span className="w-2 h-2 bg-white rounded-full"></span>
                <span>REC</span>
              </div>
            )}
          </div>
          {/* Menu Pengaturan Kamera (Tahap 40.2) - Terkunci saat merekam */}
          <div className="flex flex-wrap gap-4 bg-neutral-900 p-3 rounded-lg border border-neutral-700 max-w-md">
            <div className="flex flex-col flex-1 min-w-[120px]">
              <label className="text-xs text-gray-400 font-bold mb-1">PILIH KAMERA</label>
              <select 
                disabled={isRecording}
                value={selectedDeviceId} 
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="bg-neutral-800 border border-neutral-600 text-white rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                {devices.map((device, idx) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Kamera ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex flex-col flex-1 min-w-[120px]">
              <label className="text-xs text-gray-400 font-bold mb-1">RESOLUSI</label>
              <select 
                disabled={isRecording}
                value={resolution} 
                onChange={(e) => setResolution(e.target.value as any)}
                className="bg-neutral-800 border border-neutral-600 text-white rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="720p">HD (720p)</option>
                <option value="1080p">Full HD (1080p)</option>
              </select>
            </div>
          </div>

          <div className="flex space-x-3">
            {!isRecording ? (
              <button 
                onClick={startRecording}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg font-medium transition-colors"
              >
                Mulai Rekam
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                className="bg-neutral-600 hover:bg-neutral-500 text-white px-5 py-2 rounded-lg font-medium transition-colors"
              >
                Berhenti & Simpan Ke Antrean
              </button>
            )}
            <button 
              onClick={stopCamera}
              className="bg-transparent text-gray-400 hover:text-white px-4 py-2 transition-colors"
            >
              Matikan Kamera
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraRecorder;
