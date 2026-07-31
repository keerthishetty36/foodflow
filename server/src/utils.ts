import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./types.js";
import { prisma } from "./lib.js";
export const asyncHandler=(fn:(req:AuthRequest,res:Response,next:NextFunction)=>unknown)=>(req:AuthRequest,res:Response,next:NextFunction)=>Promise.resolve(fn(req,res,next)).catch(next);
export const audit=async(req:AuthRequest,action:string,entity:string,entityId?:string,metadata?:object)=>prisma.auditLog.create({data:{userId:req.user?.sub,action,entity,entityId,metadata}});
export const pagination=(query:Record<string,unknown>)=>({page:Math.max(1,Number(query.page)||1),limit:Math.min(100,Math.max(1,Number(query.limit)||20))});
