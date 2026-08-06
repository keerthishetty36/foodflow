const axios = require("axios");

async function test() {
  const api = axios.create({ baseURL: "http://localhost:4000/api", withCredentials: true });
  try {
    const loginRes = await api.post("/auth/login", { email: "admin@foodflow.local", password: "Admin@123" });
    const cookie = loginRes.headers['set-cookie'];
    console.log("LOGIN RESPONSE:");
    console.log(JSON.stringify(loginRes.data, null, 2));

    const apiAuth = axios.create({ baseURL: "http://localhost:4000/api", headers: { Cookie: cookie }});
    const meRes = await apiAuth.get("/auth/me");
    console.log("\nME RESPONSE:");
    console.log(JSON.stringify(meRes.data, null, 2));
  } catch (e) {
    console.log(e.response?.data || e.message);
  }
}

test();
