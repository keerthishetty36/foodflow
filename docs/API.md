# API overview

All protected requests use `Authorization: Bearer <access-token>`. Refresh tokens are HTTP-only cookies.

Core resources are exposed under `/api`: `auth`, `dashboard`, `categories`, `menu-items`, `tables`, `customers`, `orders`, `inventory`, `suppliers`, `expenses`, `reports`, `notifications`, `settings`, and `users`.

Realtime events: `order:created`, `order:updated`, `payment:completed`, and `dashboard:updated`.
