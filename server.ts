import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 初始化
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());

// 定期清理超過 15 分鐘的房間 (由伺服器端執行)
setInterval(async () => {
  const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("rooms")
    .delete()
    .lt("created_at", fifteenMinsAgo);
  
  if (!error) console.log("清理過期房間成功");
}, 60000);

async function startServer() {
  // 記憶體狀態管理
  const roomPlayers = new Map<number, { id: string, name: string, isHost: boolean }[]>();
  const roomSettings = new Map<number, { gf_type: string, mode: string, announcement: string }>();
  const socketInfo = new Map<string, { roomId: number | null, name: string }>();

  // API 路由中回傳人數資訊
  app.get("/api/rooms", async (req, res) => {
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) return res.status(500).json(error);
    
    const roomsWithCount = data.map(r => ({
      ...r,
      playerCount: (roomPlayers.get(r.id) || []).length,
      ...(roomSettings.get(r.id) || { gf_type: "G.F.100", mode: "個人模式", announcement: "" })
    }));
    
    res.json(roomsWithCount);
  });

  // API: 建立房間
  app.post("/api/rooms", async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "需要密語" });
    
    const { data, error } = await supabase
      .from("rooms")
      .insert([{ password }])
      .select()
      .single();
    
    if (error) return res.status(500).json(error);
    
    broadcast({ type: "ROOM_CREATED", room: data });
    res.json(data);
  });

  // API: 刪除房間
  app.delete("/api/rooms/:id", async (req, res) => {
    const { error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", req.params.id);
    
    if (error) return res.status(500).json(error);
    
    broadcast({ type: "ROOM_DELETED", id: req.params.id });
    res.json({ success: true });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // 在生產環境中提供編譯後的靜態檔案
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // 確保 SPA 路由正常運作
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    const socketId = Math.random().toString(36).substring(7);
    socketInfo.set(socketId, { roomId: null, name: "匿名玩家" });
    console.log(`玩家連線: ${socketId}`);

    // 發送歡迎訊息包含玩家 ID
    ws.send(JSON.stringify({ type: "WELCOME", id: socketId }));

    ws.on("message", async (msg: string) => {
      try {
        const data = JSON.parse(msg);

        if (data.type === "SET_NAME") {
          const info = socketInfo.get(socketId);
          if (info) info.name = data.name;
        }

        if (data.type === "JOIN_ROOM") {
          const roomId = Number(data.roomId);
          const info = socketInfo.get(socketId);
          if (!info) return;

          // 退出舊房間
          leaveCurrentRoom(socketId);

          // 加入新房間
          info.roomId = roomId;
          const players = roomPlayers.get(roomId) || [];
          const isFirst = players.length === 0;
          players.push({ id: socketId, name: info.name, isHost: isFirst });
          roomPlayers.set(roomId, players);

          broadcastRoomUpdate(roomId);
          broadcast({ type: "LIST_UPDATE" }); // 通知大廳人數變動
        }

        if (data.type === "LEAVE_ROOM") {
          leaveCurrentRoom(socketId);
        }

        if (data.type === "UPDATE_SETTINGS") {
          const info = socketInfo.get(socketId);
          if (info && info.roomId) {
            const players = roomPlayers.get(info.roomId) || [];
            const player = players.find(p => p.id === socketId);
            if (player?.isHost) {
              const { gf_type, mode, announcement } = data;
              roomSettings.set(info.roomId, { gf_type, mode, announcement });
              broadcast({ type: "LIST_UPDATE" });
            }
          }
        }

        if (data.type === "TRANSFER_HOST") {
          const info = socketInfo.get(socketId);
          if (info && info.roomId) {
            const players = roomPlayers.get(info.roomId) || [];
            const player = players.find(p => p.id === socketId);
            if (player?.isHost) {
              const targetId = data.targetId;
              console.log(`[HostTransfer] Room ${info.roomId}: ${socketId} -> ${targetId}`);
              const newPlayers = players.map(p => ({
                ...p,
                isHost: p.id === targetId
              }));
              roomPlayers.set(info.roomId, newPlayers);
              broadcastRoomUpdate(info.roomId);
            } else {
              console.log(`[HostTransfer] Denied: ${socketId} is not host of Room ${info.roomId}`);
            }
          }
        }
      } catch (e) {
        console.error("WS Message Error:", e);
      }
    });

    ws.on("close", () => {
      leaveCurrentRoom(socketId);
      socketInfo.delete(socketId);
      console.log(`玩家斷線: ${socketId}`);
    });

    function leaveCurrentRoom(sId: string) {
      const info = socketInfo.get(sId);
      if (info && info.roomId !== null) {
        const rId = info.roomId;
        let players = roomPlayers.get(rId) || [];
        const leavingPlayer = players.find(p => p.id === sId);
        players = players.filter(p => p.id !== sId);
        
        if (players.length === 0) {
          roomPlayers.delete(rId);
          roomSettings.delete(rId);
          // 從資料庫刪除房間
          supabase.from("rooms").delete().eq("id", rId).then(({ error }) => {
            if (!error) {
              broadcast({ type: "ROOM_DELETED", id: rId });
            }
          });
        } else {
          // 如果房主離開，隨機分配給其他人
          if (leavingPlayer?.isHost) {
            const newHostIndex = Math.floor(Math.random() * players.length);
            players[newHostIndex].isHost = true;
          }
          roomPlayers.set(rId, players);
          broadcastRoomUpdate(rId);
        }
        info.roomId = null;
        broadcast({ type: "LIST_UPDATE" });
      }
    }

    function broadcastRoomUpdate(rId: number) {
      const players = roomPlayers.get(rId) || [];
      broadcast({ type: "ROOM_PRESENCE", roomId: rId, players });
    }
  });

  function broadcast(data: any) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }
}

startServer();
