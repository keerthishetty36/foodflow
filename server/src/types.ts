import type { Role } from "@prisma/client";
import type { Request } from "express";
export interface JwtPayload { sub:string; role:Role; email:string }
export interface AuthRequest extends Request { user?:JwtPayload }
