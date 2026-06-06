import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import YouTube from 'react-youtube';
import './App.css';

const SERVER = process.env.REACT_APP_SERVER_URL || '';

const PLATFORMS = [
  { name: 'Netflix',    url: 'https://netflix.com',      icon: '🎥', color: '#e50914' },
  { name: 'Prime',      url: 'https://primevideo.com',   icon: '📦', color: '#00a8e0' },
  { name: 'Hotstar',   url: 'https://hotstar.com',      icon: '⭐', color: '#1a56db' },
  { name: 'SonyLIV',   url: 'https://sonyliv.com',      icon: '📺', color: '#ff6700' },
  { name: 'JioCinema', url: 'https://jiocinema.com',    icon: '🎞️', color: '#ac28d7' },
  { name: 'YouTube',   url: 'https://youtube.com',      icon: '▶',  color: '#ff0000' },
];

const COLORS = ['#7c3aed','#06b6d4','#f59e0b','#10b981','#ef4444','#ec4899'];
const colorMap = {};
const getColor = (n) => {
  if (!colorMap[n]) colorMap[n] = COLORS[Object.keys(colorMap).length % COLORS.length];
  return colorMap[n];
};

const peerConnections = {};
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function App() {
  const [screen, setScreen]           = useState('landing');
  const [name, setName]               = useState('');
  const [roomInput, setRoomInput]     = useState('');
  const [roomCode, setRoomCode]       = useState('');
  const [isHost, setIsHost]           = useState(false);
  const [members, setMembers]         = useState([]);
  const [messages, setMessages]       = useState([]);
  const [chatInput, setChatInput]     = useState('');
  const [sharing, setSharing]         = useState(false);
  const [micOn, setMicOn]             = useState(false);
  const [videoState, setVideoState]   = useState({ url: '', type: '' });
  const [ytInput, setYtInput]         = useState('');
  const [tab, setTab]                 = useState('chat');
  const [inviteOpen, setInviteOpen]   = useState(false);
  const [toast, setToast]             = useState('');
  const [remoteStream, setRemoteStream] = useState(null);

  const socketRef      = useRef(null);
  const screenRef      = useRef(null);
  const micRef         = useRef(null);
  const ytPlayerRef    = useRef(null);
  const localVidRef    = useRef(null);
  const remoteVidRef   = useRef(null);
  const chatEndRef     = useRef(null);
  const syncingRef     = useRef(false);
  const membersRef     = useRef([]);

  // keep membersRef in sync
  useEffect(() => { membersRef.current = members; }, [members]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (remoteVidRef.current && remoteStream) remoteVidRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // ── SOCKET ────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(SERVER);
    socketRef.current = socket;

    socket.on('room-joined', ({ code, members, isHost, videoState }) => {
      setRoomCode(code);
      setIsHost(isHost);
      setMembers(members);
      setVideoState(videoState);
      setScreen('room');
      addSys(`Welcome! Room ${code} is ready. ${isHost ? '👑 You are the host.' : 'You joined as viewer.'}`);
    });

    socket.on('user-joined', ({ name, members }) => {
      setMembers(members);
      addSys(`${name} joined the party 🎉`);
    });

    socket.on('user-left', ({ name, members }) => {
      setMembers(members);
      addSys(`${name} left the room.`);
    });

    socket.on('new-host', ({ name }) => addSys(`👑 ${name} is now the host.`));

    socket.on('chat-message', ({ name, text }) => {
      setMessages(m => [...m, { name, text, type: 'msg' }]);
    });

    socket.on('set-video', ({ url, type }) => {
      setVideoState({ url, type });
      addSys('▶ Host loaded a new video.');
    });

    socket.on('video-sync', ({ playing, time }) => {
      if (!ytPlayerRef.current) return;
      syncingRef.current = true;
      const cur = ytPlayerRef.current.getCurrentTime();
      if (Math.abs(cur - time) > 1.5) ytPlayerRef.current.seekTo(time, true);
      playing ? ytPlayerRef.current.playVideo() : ytPlayerRef.current.pauseVideo();
      setTimeout(() => { syncingRef.current = false; }, 500);
    });

    // WebRTC
    socket.on('webrtc-offer', async ({ from, offer }) => {
      const pc = makePeer(from, socket);
      peerConnections[from] = pc;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { to: from, answer });
    });

    socket.on('webrtc-answer', async ({ from, answer }) => {
      await peerConnections[from]?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('webrtc-ice', ({ from, candidate }) => {
      peerConnections[from]?.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on('screen-share-start', ({ name }) => addSys(`🖥️ ${name} is sharing their screen.`));
    socket.on('screen-share-stop', () => { setRemoteStream(null); addSys('🖥️ Screen share ended.'); });

    return () => socket.disconnect();
  }, []);

  function makePeer(peerId, socket) {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = e => { if (e.candidate) socket.emit('webrtc-ice', { to: peerId, candidate: e.candidate }); };
    pc.ontrack = e => setRemoteStream(e.streams[0]);
    return pc;
  }

  function addSys(text) { setMessages(m => [...m, { text, type: 'sys' }]); }

  // ── JOIN ──────────────────────────────────────────────────────
  function joinRoom() {
    if (!name.trim()) { showToast('Enter your name!'); return; }
    socketRef.current.emit('join-room', { name: name.trim(), roomCode: roomInput.trim() || undefined });
  }

  // ── SCREEN SHARE ──────────────────────────────────────────────
  async function toggleShare() {
    if (!sharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        screenRef.current = stream;
        if (localVidRef.current) localVidRef.current.srcObject = stream;
        setSharing(true);
        socketRef.current.emit('screen-share-start');

        const socket = socketRef.current;
        membersRef.current.filter(m => m.id !== socket.id).forEach(async member => {
          const pc = makePeer(member.id, socket);
          peerConnections[member.id] = pc;
          stream.getTracks().forEach(t => pc.addTrack(t, stream));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc-offer', { to: member.id, offer });
        });

        stream.getVideoTracks()[0].onended = stopShare;
      } catch (e) {
        if (e.name !== 'AbortError') showToast('Screen share cancelled.');
      }
    } else stopShare();
  }

  function stopShare() {
    screenRef.current?.getTracks().forEach(t => t.stop());
    screenRef.current = null;
    if (localVidRef.current) localVidRef.current.srcObject = null;
    setSharing(false);
    socketRef.current.emit('screen-share-stop');
    Object.values(peerConnections).forEach(pc => pc.close());
    Object.keys(peerConnections).forEach(k => delete peerConnections[k]);
  }

  // ── MIC ───────────────────────────────────────────────────────
  async function toggleMic() {
    if (!micOn) {
      try {
        micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicOn(true);
        addSys('🎤 Your mic is ON — friends can hear you!');
      } catch { showToast('Mic permission denied.'); }
    } else {
      micRef.current?.getTracks().forEach(t => t.stop());
      micRef.current = null;
      setMicOn(false);
      addSys('🔇 Mic turned off.');
    }
  }

  // ── YOUTUBE ───────────────────────────────────────────────────
  function loadYT() {
    const id = getYTId(ytInput);
    if (!id) { showToast('Invalid YouTube URL!'); return; }
    const url = `https://www.youtube.com/watch?v=${id}`;
    setYtInput('');
    socketRef.current.emit('set-video', { url, type: 'youtube' });
    setVideoState({ url, type: 'youtube' });
  }

  function getYTId(url) {
    const m = url.match(/(?:youtu\.be\/|v=|\/embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function onYTReady(e) { ytPlayerRef.current = e.target; }

  function onYTStateChange(e) {
    if (syncingRef.current || !isHost) return;
    socketRef.current.emit('video-sync', {
      playing: e.data === 1,
      time: e.target.getCurrentTime()
    });
  }

  // ── CHAT ──────────────────────────────────────────────────────
  function sendMsg() {
    if (!chatInput.trim()) return;
    socketRef.current.emit('chat-message', { text: chatInput.trim() });
    setChatInput('');
  }

  // ── INVITE ────────────────────────────────────────────────────
  function copyInvite() {
    navigator.clipboard.writeText(`Room Code: ${roomCode}\n${window.location.origin}?room=${roomCode}`);
    showToast('✅ Copied!');
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  function leaveRoom() {
    stopShare();
    micRef.current?.getTracks().forEach(t => t.stop());
    micRef.current = null;
    socketRef.current.disconnect();
    socketRef.current.connect();
    setScreen('landing');
    setMessages([]); setMembers([]); setSharing(false); setMicOn(false);
    setVideoState({ url: '', type: '' }); setRemoteStream(null);
  }

  const ytId = videoState.type === 'youtube' ? getYTId(videoState.url) : null;

  // ── LANDING ──────────────────────────────────────────────────
  if (screen === 'landing') return (
    <div className="landing">
      <h1>🎬 WatchParty</h1>
      <p>Watch Netflix, Prime, YouTube together in real-time</p>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" onKeyDown={e => e.key === 'Enter' && joinRoom()} />
      <input value={roomInput} onChange={e => setRoomInput(e.target.value)} placeholder="Room code (blank = create new room)" onKeyDown={e => e.key === 'Enter' && joinRoom()} />
      <button className="btn-primary" onClick={joinRoom}>Join / Create Room →</button>
      <div className="how-box">
        <h3>How it works</h3>
        {[
          'Create a room & share the invite code with friends',
          'Open Netflix / Prime / Hotstar / YouTube in another tab',
          'Click Share Screen → select that tab to stream it',
          'Friends join your room and watch live with chat & mic!'
        ].map((s, i) => (
          <div key={i} className="step"><span className="num">{i + 1}</span>{s}</div>
        ))}
      </div>
    </div>
  );

  // ── ROOM ─────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* TOPBAR */}
      <div className="topbar">
        <div className="tl">
          <span className="logo">🎬 WatchParty</span>
          <span className="room-badge">Room: <b>{roomCode}</b></span>
          {isHost && <span className="host-badge">👑 Host</span>}
          <button className="invite-btn" onClick={() => setInviteOpen(true)}>📋 Invite</button>
        </div>
        <div className="tr">
          {members.map(m => (
            <div key={m.id} className="av" title={m.name}
              style={{ background: getColor(m.name) + '33', border: `1.5px solid ${getColor(m.name)}`, color: getColor(m.name) }}>
              {m.name[0].toUpperCase()}
            </div>
          ))}
          <span className="online-pill">👥 {members.length}</span>
          <button className="leave-btn" onClick={leaveRoom}>✕ Leave</button>
        </div>
      </div>

      <div className="main">
        {/* VIDEO AREA */}
        <div className="video-area">
          <div className="video-wrap">
            {remoteStream && !sharing && <video ref={remoteVidRef} autoPlay playsInline className="screen-video" />}
            {sharing && <video ref={localVidRef} autoPlay playsInline muted className="screen-video" />}
            {ytId && !sharing && !remoteStream && (
              <YouTube videoId={ytId}
                opts={{ width: '100%', height: '100%', playerVars: { autoplay: 1 } }}
                onReady={onYTReady} onStateChange={onYTStateChange} className="yt-player" />
            )}
            {!sharing && !remoteStream && !ytId && (
              <div className="empty-state">
                <div className="big-icon">🖥️</div>
                <h2>{isHost ? 'Nothing playing yet' : 'Waiting for host...'}</h2>
                <p>{isHost
                  ? 'Open a platform below, log in, play a movie — then click Share Screen'
                  : 'The host will share their screen or load a YouTube video soon'}</p>
                <div className="platform-grid">
                  {PLATFORMS.map(p => (
                    <a key={p.name} href={p.url} target="_blank" rel="noreferrer"
                      className="plat-btn" style={{ borderColor: p.color }}>
                      {p.icon} {p.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* CONTROLS */}
          <div className="controls">
            {isHost && (
              <>
                <button className={`ctrl ${sharing ? 'share-on' : ''}`} onClick={toggleShare}>
                  🖥️ {sharing ? 'Stop Sharing' : 'Share Screen'}
                </button>
                <div className="yt-row">
                  <input value={ytInput} onChange={e => setYtInput(e.target.value)}
                    placeholder="Paste YouTube URL..." onKeyDown={e => e.key === 'Enter' && loadYT()} />
                  <button className="ctrl" onClick={loadYT}>▶ Load</button>
                </div>
              </>
            )}
            <button className={`ctrl ${micOn ? 'mic-on' : ''}`} onClick={toggleMic}>
              🎤 {micOn ? 'Mic On' : 'Mic Off'}
            </button>
          </div>
        </div>

        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="tabs">
            {['chat', 'members'].map(t => (
              <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t === 'chat' ? '💬 Chat' : '👥 Members'}
              </div>
            ))}
          </div>

          {tab === 'chat' && (
            <div className="tab-pane">
              <div className="chat-msgs">
                {messages.map((m, i) => m.type === 'sys'
                  ? <div key={i} className="sys-msg">{m.text}</div>
                  : (
                    <div key={i} className={`msg ${m.name === name ? 'mine' : ''}`}>
                      <div className="msg-av"
                        style={{ background: getColor(m.name) + '22', border: `1px solid ${getColor(m.name)}`, color: getColor(m.name) }}>
                        {m.name[0].toUpperCase()}
                      </div>
                      <div className="msg-body">
                        <div className="msg-name">{m.name}</div>
                        <span className="msg-text">{m.text}</span>
                      </div>
                    </div>
                  )
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder="Message..." onKeyDown={e => e.key === 'Enter' && sendMsg()} />
                <button onClick={sendMsg}>➤</button>
              </div>
            </div>
          )}

          {tab === 'members' && (
            <div className="tab-pane">
              {members.map(m => (
                <div key={m.id} className="member">
                  <div className="av"
                    style={{ background: getColor(m.name) + '22', border: `1.5px solid ${getColor(m.name)}`, color: getColor(m.name) }}>
                    {m.name[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="m-name">{m.name}{m.name === name ? ' (You)' : ''}</div>
                    <div className="m-status">{m.id === members[0]?.id ? '👑 Host' : '👁 Viewer'}</div>
                  </div>
                  <div className="dot" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* INVITE MODAL */}
      {inviteOpen && (
        <div className="modal-bg" onClick={() => setInviteOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>🔗 Invite Friends</h3>
            <p>Share your room code:</p>
            <div className="inv-box" onClick={copyInvite}><b style={{ fontSize: '1.4rem' }}>{roomCode}</b></div>
            <p style={{ fontSize: '.8rem', color: '#64748b', marginBottom: 8 }}>or share this link:</p>
            <div className="inv-box small" onClick={copyInvite}>{window.location.origin}?room={roomCode}</div>
            <div className="modal-btns">
              <button onClick={() => setInviteOpen(false)}>Close</button>
              <button className="btn-primary" onClick={copyInvite}>📋 Copy</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
