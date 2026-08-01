import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import { prisma, logger } from "../lib.js";
import { emit } from "../realtime.js";

// Ensure directories exist
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const MENU_ITEMS_DIR = path.join(UPLOADS_DIR, "menu-items");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(MENU_ITEMS_DIR)) {
  fs.mkdirSync(MENU_ITEMS_DIR, { recursive: true });
}

function filenameFor(menuItemName: string, menuItemId: string) {
  const slug = menuItemName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "menu-item";

  // The item id and UUID make every generated asset distinct, even when two jobs
  // happen during the same millisecond.
  return `${slug}-${menuItemId}-${randomUUID()}.jpg`;
}

export async function generateAndSaveFoodImage(menuItemName: string, menuItemId: string) {
  try {
    // 1. Check if another item with the exact same name has an image
    const existingItem = await prisma.menuItem.findFirst({
      where: {
        name: menuItemName,
        image: {
          not: null,
          notIn: ["GENERATING"],
          startsWith: "/uploads/menu-items/"
        },
        id: { not: menuItemId }
      }
    });

    if (existingItem && existingItem.image) {
      logger.info(`Reusing existing image for ${menuItemName}`);
      const updated = await prisma.menuItem.update({
        where: { id: menuItemId },
        data: { image: existingItem.image }
      });
      emit("menu:updated", updated);
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      logger.warn("OPENAI_API_KEY is not set. Image generation skipped.");
      const updated = await prisma.menuItem.update({
        where: { id: menuItemId },
        data: { image: null }
      });
      emit("menu:updated", updated);
      return;
    }

    logger.info(`Generating Image for ${menuItemName}`);
    
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `A professional ultra realistic restaurant food photograph of ${menuItemName}, beautifully plated, natural lighting, premium food photography.`;

    console.log(`\n--- IMAGE GENERATION DEBUG ---`);
    console.log(`Food Name: ${menuItemName}`);
    console.log(`Generated Prompt: ${prompt}`);

    const response = await openai.images.generate({
      model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "jpeg",
    });

    const generatedImage = response.data?.[0];
    let buffer: Buffer;
    if (generatedImage?.b64_json) {
      buffer = Buffer.from(generatedImage.b64_json, "base64");
    } else if (generatedImage?.url) {
      // Retain compatibility with URL-returning image models.
      logger.info(`Downloading Image for ${menuItemName}`);
      const imageResponse = await fetch(generatedImage.url);
      if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
      buffer = Buffer.from(await imageResponse.arrayBuffer());
    } else {
      throw new Error("No image data returned from OpenAI");
    }

    const filename = filenameFor(menuItemName, menuItemId);
    const filepath = path.join(MENU_ITEMS_DIR, filename);

    await fs.promises.writeFile(filepath, buffer);
    logger.info(`Image Saved for ${menuItemName}`);

    // Update database
    const dbPath = `/uploads/menu-items/${filename}`;
    
    console.log(`Generated Image URL: ${generatedImage?.url || "base64 data"}`);
    console.log(`Saved Filename: ${filename}`);
    console.log(`Database Image Path: ${dbPath}`);
    console.log(`------------------------------\n`);

    const updated = await prisma.menuItem.update({
      where: { id: menuItemId },
      data: { image: dbPath }
    });
    
    logger.info(`Database Updated for ${menuItemName}`);
    emit("menu:updated", updated);

  } catch (error: any) {
    logger.error(`Generation Failed for ${menuItemName}: ${error.message}`);
    // If generation fails, keep menu item but set image=null
    try {
      const updated = await prisma.menuItem.update({
        where: { id: menuItemId },
        data: { image: null }
      });
      emit("menu:updated", updated);
    } catch (dbError) {
      logger.error(`Failed to update DB after image generation failure: ${dbError}`);
    }
  }
}
