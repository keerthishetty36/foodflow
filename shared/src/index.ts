export const ROLES = ["ADMIN", "CASHIER"] as const;
export type Role = (typeof ROLES)[number];
export const ORDER_STATUSES = ["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED", "PAID", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "WALLET", "SPLIT"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ApiResponse<T> = { data: T; message?: string; meta?: { page: number; limit: number; total: number } };
export interface AuthUser { id: string; name: string; email: string; role: Role; }
export interface CartItem { menuItemId: string; name: string; quantity: number; price: number; tax: number; discount: number; notes?: string; image?: string | null; }
