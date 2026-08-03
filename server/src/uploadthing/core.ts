import { createUploadthing, type FileRouter } from "uploadthing/server";

const f = createUploadthing();

export const uploadRouter = {
    imageUploader: f({
        image: {
            maxFileSize: "8MB",
            maxFileCount: 1,
        },
    }).onUploadComplete(async ({ file }) => {
        console.log("Upload complete:", file.url);

        return {
            imageUrl: file.url,
        };
    }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;