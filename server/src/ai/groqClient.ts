import Groq from "groq-sdk";

export const getGroqClient = () => {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
};

export const MODEL = "llama-3.3-70b-versatile";
