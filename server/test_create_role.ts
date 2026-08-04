import { executeTool } from "./src/ai/tools.js";
import { prisma } from "./src/lib.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No user found.");
    return;
  }
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET || "supersecret", { expiresIn: "1d" });
  
  console.log("Executing CREATE_ROLE...");
  const res = await executeTool("CREATE_ROLE", {
    name: "cleaner_" + Date.now(),
    permissions: ["dashboard.view"],
    description: "Admin dashboard view permission"
  }, token);

  console.log("Result:", res);
  
  if (res.success && res.data) {
     console.log("Role created successfully in MongoDB:", res.data);
  } else {
     console.error("Failed to create role:", res.error, res.message);
  }
}

main().catch(console.error).finally(() => process.exit(0));
