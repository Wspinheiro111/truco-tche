// Bundle socket.io-client via Vite — elimina dependência de CDN
import { io } from "socket.io-client";
(window as any).io = io;
// Usar setTimeout(0) para garantir que outros listeners já foram registrados
setTimeout(() => window.dispatchEvent(new Event('socket-io-ready')), 0);
