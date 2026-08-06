const axios = require("axios");

async function test() {
  const api = axios.create({ baseURL: "http://localhost:4000/api", withCredentials: true });
  try {
    const loginRes = await api.post("/auth/login", { email: "admin@foodflow.local", password: "Admin@123" });
    const cookie = loginRes.headers['set-cookie'];
    const apiAuth = axios.create({ baseURL: "http://localhost:4000/api", headers: { Cookie: cookie }});

    // 1. Create a Role
    const roleRes = await apiAuth.post("/roles", {
      name: "Test Role " + Date.now(),
      description: "Test",
      permissions: ["tables.view"]
    });
    const roleId = roleRes.data.data.id;
    console.log("Created Role:", roleId);

    // 2. Create a User
    const email = "test" + Date.now() + "@test.com";
    const userRes = await apiAuth.post("/users", {
      name: "Test User",
      email: email,
      password: "Password123",
      roleId: roleId,
      role: "CASHIER"
    });
    console.log("Created User:", userRes.data.data);

    // 3. Login as new User
    const loginUserRes = await api.post("/auth/login", { email: email, password: "Password123" });
    console.log("New User Login:", JSON.stringify(loginUserRes.data.data, null, 2));
  } catch (e) {
    console.log("ERROR:", e.response?.data || e.message);
  }
}
test();
