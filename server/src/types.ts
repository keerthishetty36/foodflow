import type { RoleEnum } from "@prisma/client";
import type { Request } from "express";
export interface JwtPayload { sub:string; role:RoleEnum; email:string }
export interface AuthRequest extends Request { user?:JwtPayload & { permissions: string[] } }
