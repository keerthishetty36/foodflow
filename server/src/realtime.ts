import type { Server } from "socket.io";
let io:Server;
export const setIo=(server:Server)=>{io=server};
export const emit=(event:string,payload:unknown)=>io?.emit(event,payload);
