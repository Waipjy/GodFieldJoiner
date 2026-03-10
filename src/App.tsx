import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Users, Plus, Copy, ExternalLink, Trash2, RefreshCw } from "lucide-react";

interface Room {
  id: number;
  password: string;
  created_at: string;
  playerCount: number;
  gf_type?: string;
  mode?: string;
  announcement?: string;
}

interface Player {
  id: string;
  name: string;
  isHost?: boolean;
}

export default function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const activeRoomIdRef = useRef<number | null>(null); // 用於解決 WebSocket 閉包問題
  const [roomPlayers, setRoomPlayers] = useState<Player[]>([]);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("gf_name") || "匿名玩家");
  const [myId, setMyId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [isAndroid, setIsAndroid] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    fetchRooms();
    connectWebSocket();
    const ua = navigator.userAgent.toLowerCase();
    const android = ua.indexOf("android") > -1;
    const ios = /iphone|ipad|ipod/.test(ua);
    setIsAndroid(android);
    setIsIOS(ios);
    setIsMobile(android || ios);
    return () => socketRef.current?.close();
  }, []);

  // 當 activeRoom 改變時，同步更新 Ref
  useEffect(() => {
    activeRoomIdRef.current = activeRoom?.id || null;
  }, [activeRoom]);

  useEffect(() => {
    localStorage.setItem("gf_name", playerName);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "SET_NAME", name: playerName }));
    }
  }, [playerName]);

  const fetchRooms = async () => {
    try {
      const res = await fetch("/api/rooms");
      const data = await res.json();
      setRooms(data);
      
      // 同步更新當前房間的設定
      if (activeRoomIdRef.current) {
        const currentRoom = data.find((r: Room) => r.id === activeRoomIdRef.current);
        if (currentRoom) {
          setActiveRoom(currentRoom);
        }
      }
    } catch (err) {
      console.error("無法讀取房間列表", err);
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "SET_NAME", name: playerName }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "WELCOME") {
        setMyId(data.id);
      } else if (data.type === "ROOM_CREATED") {
        // 移除樂觀更新，統一由 LIST_UPDATE 觸發 fetchRooms 以確保人數正確
        fetchRooms();
      } else if (data.type === "ROOM_DELETED") {
        setRooms(prev => prev.filter(r => r.id !== Number(data.id)));
        if (activeRoomIdRef.current === Number(data.id)) {
          setActiveRoom(null);
          alert("房間已解散");
        }
      } else if (data.type === "LIST_UPDATE") {
        fetchRooms();
      } else if (data.type === "ROOM_PRESENCE") {
        // 使用 Ref 判斷，避免閉包抓到舊的 null 值
        if (activeRoomIdRef.current === data.roomId) {
          setRoomPlayers(data.players);
        }
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
    
    socketRef.current = ws;
  };

  const handleCreateRoom = async (e?: React.FormEvent, customPassword?: string) => {
    if (e) e.preventDefault();
    const passwordToUse = customPassword || newPassword;
    if (!passwordToUse.trim()) return;

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordToUse }),
      });
      if (res.ok) {
        const room = await res.json();
        setNewPassword("");
        setIsCreating(false);
        handleJoinRoom(room);
      }
    } catch (err) {
      alert("建立失敗");
    }
  };

  const handleRandomJoin = () => {
    if (rooms.length > 0) {
      const randomIndex = Math.floor(Math.random() * rooms.length);
      handleJoinRoom(rooms[randomIndex]);
    } else {
      // 產生隨機 4 位英數密語
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let randomPass = "";
      for (let i = 0; i < 4; i++) {
        randomPass += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      handleCreateRoom(undefined, randomPass);
    }
  };

  const updateSettings = (gf_type: string, mode: string, announcement: string) => {
    socketRef.current?.send(JSON.stringify({
      type: "UPDATE_SETTINGS",
      gf_type,
      mode,
      announcement
    }));
  };

  const handleTransferHost = (targetId: string) => {
    socketRef.current?.send(JSON.stringify({
      type: "TRANSFER_HOST",
      targetId
    }));
  };

  const handleJoinRoom = (room: Room) => {
    setActiveRoom(room);
    copyToClipboard(room.password);
    socketRef.current?.send(JSON.stringify({ type: "JOIN_ROOM", roomId: room.id }));
  };

  const handleLeaveRoom = () => {
    setActiveRoom(null);
    setRoomPlayers([]);
    socketRef.current?.send(JSON.stringify({ type: "LEAVE_ROOM" }));
  };

  const handleLaunchGame = (type: 'web' | 'app') => {
    if (type === 'web') {
      alert(`【自動化限制提示】\n由於瀏覽器安全限制，無法自動填寫遊戲內表單。\n\n請依序執行：\n1. 填寫暱稱「${playerName}」並點擊【誕生】\n2. 選擇【私密亂鬥】\n3. 貼上密語「${activeRoom?.password}」\n4. 點擊【吟唱】`);
      window.open("https://godfield.net/", "godfield_game");
    } else {
      if (isAndroid) {
        // 補上 // 以符合標準 URI 格式，增加不同瀏覽器的相容性
        const intentUrl = "intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=net.godfield;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dnet.godfield;end";
        window.location.href = intentUrl;
      } else if (isIOS) {
        // iOS 嘗試開啟 App，若未安裝則導向 App Store
        // 註：App Store 頁面若已安裝 App 會顯示「開啟」按鈕
        const appStoreUrl = "https://apps.apple.com/app/id1536427424";
        window.location.href = appStoreUrl;
      }
    }
  };

  const copyToClipboard = (text: string, label?: string) => {
    navigator.clipboard.writeText(text);
    if (label) alert(`${label}已複製！`);
  };

  const handleDeleteRoom = async (id: number) => {
    await fetch(`/api/rooms/${id}`, { method: "DELETE" });
  };

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col overflow-hidden">
      <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col p-4 md:p-8 overflow-hidden">
        {/* Header */}
        {!activeRoom && (
          <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 shrink-0">
            <div>
              <h1 className="text-3xl font-bold tracking-tighter text-emerald-500">神界配對</h1>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="relative">
                <input 
                  type="text"
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    localStorage.setItem("gf_name", e.target.value);
                    socketRef.current?.send(JSON.stringify({ type: "SET_NAME", name: e.target.value }));
                  }}
                  placeholder="輸入你的名字"
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 w-32 sm:w-40"
                />
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={handleRandomJoin}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl transition-all active:scale-95 whitespace-nowrap text-sm font-medium border border-zinc-700"
                >
                  隨機加入
                </button>
                <button 
                  onClick={() => setIsCreating(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap"
                >
                  <Plus size={20} />
                  <span>我要開房</span>
                </button>
              </div>
            </div>
          </header>
        )}

        {/* Create Room Modal */}
        <AnimatePresence>
          {isCreating && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl mb-8 shadow-2xl"
            >
              <h2 className="text-xl font-semibold mb-4">設定房間密語</h2>
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <input 
                  autoFocus
                  type="text"
                  placeholder="例如: 1234 或 GF99"
                  className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <div className="flex gap-3">
                  <button 
                    type="submit"
                    className="flex-1 bg-emerald-600 py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors"
                  >
                    確認開房
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="flex-1 bg-zinc-800 py-3 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Room Detail View */}
        <AnimatePresence mode="wait">
          {activeRoom ? (
            <motion.div
              key="room-detail"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl space-y-6 flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between shrink-0">
                <button onClick={handleLeaveRoom} className="text-zinc-500 hover:text-white transition-colors flex items-center gap-2">
                  <RefreshCw size={16} className="rotate-180" />
                  <span>離開房間</span>
                </button>
                <div className="flex flex-col items-end">
                  <div className="text-emerald-500 font-mono font-bold text-xl">
                    密語: {activeRoom.password}
                  </div>
                  {roomPlayers.find(p => p.id === myId)?.isHost && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-full mt-1">你是房主</span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar">
                {/* Room Settings */}
                <div className="bg-zinc-800/30 p-4 rounded-2xl border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">房間設定</h3>
                    {roomPlayers.find(p => p.id === myId)?.isHost && (
                      <span className="text-[10px] text-zinc-500 italic">房主可修改</span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <select 
                      disabled={!roomPlayers.find(p => p.id === myId)?.isHost}
                      value={activeRoom.gf_type || "G.F.100"}
                      onChange={(e) => updateSettings(e.target.value, activeRoom.mode || "個人模式", activeRoom.announcement || "")}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                    >
                      {["G.F.1", "G.F.50", "G.F.75", "G.F.100", "G.F.150"].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <select 
                      disabled={!roomPlayers.find(p => p.id === myId)?.isHost}
                      value={activeRoom.mode || "個人模式"}
                      onChange={(e) => updateSettings(activeRoom.gf_type || "G.F.100", e.target.value, activeRoom.announcement || "")}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                    >
                      {["個人模式", "組隊模式"].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  
                  <input 
                    type="text"
                    disabled={!roomPlayers.find(p => p.id === myId)?.isHost}
                    placeholder="輸入公告文字..."
                    value={activeRoom.announcement || ""}
                    onChange={(e) => updateSettings(activeRoom.gf_type || "G.F.100", activeRoom.mode || "個人模式", e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-zinc-400 text-sm uppercase tracking-widest">房內玩家 ({roomPlayers.length})</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {roomPlayers.map((p) => (
                      <div key={p.id} className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50 flex items-center justify-between group">
                        <div className="flex items-center gap-2 truncate">
                          <div className={`w-2 h-2 rounded-full ${p.isHost ? 'bg-yellow-500' : 'bg-emerald-500'} animate-pulse`} />
                          <span className="truncate">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.isHost ? (
                            <span className="text-[10px] text-yellow-500 font-bold">HOST</span>
                          ) : (
                            roomPlayers.find(player => player.id === myId)?.isHost && (
                              <button 
                                onClick={() => handleTransferHost(p.id)}
                                className="text-[10px] bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-2 py-1 rounded md:opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                讓位
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800 space-y-3 shrink-0">
                <p className="text-xs text-zinc-500 text-center">密語已複製！請點擊下方按鈕開啟遊戲並貼上密語。</p>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    {!isMobile ? (
                      <button 
                        onClick={() => handleLaunchGame('web')}
                        className="flex-1 bg-zinc-100 text-zinc-900 py-4 rounded-2xl font-bold hover:bg-white transition-all flex items-center justify-center gap-2"
                      >
                        <ExternalLink size={20} />
                        開啟網頁版
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleLaunchGame('app')}
                        className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-500 transition-all flex items-center justify-center gap-2"
                      >
                        <ExternalLink size={20} />
                        開啟 App 版
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Room List */
            <motion.div 
              key="room-list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 flex flex-col overflow-hidden space-y-4"
            >
              <div className="flex items-center justify-between text-zinc-500 text-sm px-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Users size={16} />
                  <span>目前在線房間 ({rooms.length})</span>
                </div>
                <button onClick={fetchRooms} className="hover:text-emerald-500 transition-colors">
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {rooms.length === 0 && !loading && (
                  <div className="text-center py-20 border-2 border-dashed border-zinc-800 rounded-3xl">
                    <p className="text-zinc-600">目前沒有房間，快去開一個吧！</p>
                  </div>
                )}

                <AnimatePresence mode="popLayout">
                  <div className="space-y-4">
                    {rooms.map((room) => (
                      <motion.div
                        key={room.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl flex items-center justify-between group hover:border-emerald-500/50 transition-all"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex items-baseline gap-0.5">
                            <span className={`text-3xl font-bold ${room.playerCount >= 8 ? 'text-red-500' : 'text-emerald-500'}`}>
                              {room.playerCount}
                            </span>
                            <span className="text-zinc-500 font-medium">/8</span>
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold text-white flex items-center gap-2">
                              {room.password}
                              <div className="flex gap-1">
                                {room.mode && (
                                  <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
                                    {room.mode}
                                  </span>
                                )}
                                {room.gf_type && (
                                  <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                    {room.gf_type}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-[10px] text-zinc-600">
                              {new Date(room.created_at).toLocaleTimeString()}
                            </div>
                            {room.announcement && (
                              <div className="text-[10px] text-zinc-500 mt-1 italic truncate max-w-[150px]">
                                "{room.announcement}"
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleJoinRoom(room)}
                            className="bg-emerald-600/10 text-emerald-500 px-8 py-3 rounded-xl font-bold hover:bg-emerald-600 hover:text-white transition-all border border-emerald-500/20"
                          >
                            加入
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Info */}
        <footer className="mt-8 text-center text-zinc-600 text-[10px] space-y-1 shrink-0 pb-4">
          <p>提示：點擊「加入」會進入房間大廳，您可以與其他玩家確認後再開啟遊戲。</p>
          <p>斷線或關閉分頁將自動退出房間，房間人數歸零時會自動刪除。</p>
        </footer>
      </div>
    </div>
  );
}
