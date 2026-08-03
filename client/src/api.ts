import axios from "axios"; import { useAuthStore } from "./store";
export const api=axios.create({baseURL:import.meta.env.VITE_API_URL || "http://localhost:4000/api",withCredentials:true});
let refreshing:Promise<void>|null=null; api.interceptors.response.use(r=>r,async error=>{const original=error.config;if(error.response?.status===401&&original&&!original._retry&&!String(original.url||"").includes("/auth/")){original._retry=true;try{refreshing??=api.post("/auth/refresh").then(r=>{useAuthStore.getState().setSession(r.data.data);}).finally(()=>refreshing=null);await refreshing;return api(original)}catch{useAuthStore.getState().clear()}}return Promise.reject(error)});
export const get=<T>(url:string,params?:object)=>api.get<{data:T}>(url,{params}).then(r=>r.data.data);
