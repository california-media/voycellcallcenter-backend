import React, { useEffect, useState, useRef } from "react";

// --- CONFIGURATION ---
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI2OTMzZDBiZWUwNjkzZjY3NWYxYTk1MTAiLCJzZXNzaW9uSWQiOiI0NmM1MmU3MTM3NzU5MGE2ZWFhZDIyZmRmYjQ1MjAxNzlmYjRhZDZkZjc3MGJmOWZhZGY1ZDA4MTMwYWExYWUwIiwiaWF0IjoxNzY4ODg3MjI5LCJleHAiOjE3Njk0OTIwMjl9.FFYLybN3nE0mtrA8EUKUJgn_-R905E2JgAyLLrNT0Tk";

const WS_URL = `wss://o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production?token=${TOKEN}`;
// 
// const WS_URL = `wss://o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production`;


const App = () => {
  const [status, setStatus] = useState("Connecting...");
  const [messages, setMessages] = useState([]);
  const socket = useRef(null);
  const reconnectTimeout = useRef(null);

  const connectWebSocket = () => {
    console.log("🔌 Attempting to connect to AWS WebSocket...");
    socket.current = new WebSocket(WS_URL);

    socket.current.onopen = () => {
      console.log("✅ Connected to AWS WebSocket");
      setStatus("Connected");
      // Clear any pending reconnection attempts
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };

    socket.current.onmessage = (event) => {
      try {
        console.log("📩 Raw data received:", event.data);
        const payload = JSON.parse(event.data);

        // Match the structure sent by your Webhook: { type: "whatsapp_message", data: {...} }
        setMessages((prev) => [payload, ...prev]);
      } catch (err) {
        console.error("❌ Error parsing message:", err);
      }
    };

    socket.current.onclose = (e) => {
      console.log(`🔌 Connection closed (Code: ${e.code}). Reconnecting in 3s...`);
      setStatus("Disconnected - Retrying...");
      // Auto-reconnect logic
      reconnectTimeout.current = setTimeout(connectWebSocket, 3000);
    };

    socket.current.onerror = (err) => {
      console.error("❌ WebSocket Error:", err);
      socket.current.close();
    };
  };

  useEffect(() => {
    connectWebSocket();

    // Cleanup on component unmount
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (socket.current) socket.current.close();
    };
  }, []);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.titleGroup}>
          <h2 style={{ margin: 0 }}>📲 WhatsApp Live Feed</h2>
          <span style={{
            ...styles.badge,
            backgroundColor: status === "Connected" ? "#4CAF50" : "#FF9800"
          }}>
            {status}
          </span>
        </div>
      </header>

      <main style={styles.messageList}>
        {messages.length === 0 ? (
          <p style={styles.emptyState}>Waiting for incoming WhatsApp messages...</p>
        ) : (
          messages.map((msg, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.phone}>📞 {msg.data?.from}</span>
                <span style={styles.time}>
                  {msg.data?.timestamp
                    ? new Date(msg.data.timestamp * 1000).toLocaleTimeString()
                    : "Just now"}
                </span>
              </div>
              <div style={styles.cardBody}>
                {msg.data?.text || "No text content"}
              </div>
              <div style={styles.cardFooter}>
                Type: {msg.type}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
};

// --- SIMPLE STYLING ---
const styles = {
  container: {
    fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif",
    maxWidth: "600px",
    margin: "0 auto",
    backgroundColor: "#f0f2f5",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "20px",
    backgroundColor: "#075e54",
    color: "white",
    boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
  },
  titleGroup: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    padding: "5px 10px",
    borderRadius: "15px",
    fontSize: "0.8rem",
    fontWeight: "bold",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "8px",
    padding: "15px",
    marginBottom: "15px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    borderLeft: "5px solid #25d366",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "10px",
    fontSize: "0.9rem",
    color: "#666",
  },
  phone: {
    fontWeight: "bold",
    color: "#075e54",
  },
  cardBody: {
    fontSize: "1.1rem",
    color: "#333",
    lineHeight: "1.4",
  },
  cardFooter: {
    marginTop: "10px",
    fontSize: "0.7rem",
    color: "#999",
    textAlign: "right",
  },
  emptyState: {
    textAlign: "center",
    color: "#888",
    marginTop: "50px",
  }
};

export default App;