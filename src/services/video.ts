import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import { tmpdir } from "os";
import path from "path";
import youtubeDl from "youtube-dl-exec";

export class VideoService {
    static serviceType = "VIDEO";
    private cacheKey = "content/video";
    private dataDir = "./content_cache";

    private queue: string[] = [];
    private processing = false;

    constructor() {
        this.ensureDataDirectoryExists();
    }

    static getInstance(): VideoService {
        return new VideoService();
    }

    getInstance() {
        return VideoService.getInstance();
    }

    async initialize(_runtime: any): Promise<void> {}

    private ensureDataDirectoryExists() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir);
        }
    }

    public isVideoUrl(url: string): boolean {
        return (
            url.includes("youtube.com") ||
            url.includes("youtu.be") ||
            url.includes("vimeo.com")
        );
    }

    public async downloadMedia(url: string): Promise<string> {
        const videoId = this.getVideoId(url);
        const outputFile = path.join(this.dataDir, `${videoId}.mp4`);

        // if it already exists, return it
        if (fs.existsSync(outputFile)) {
            return outputFile;
        }

        try {
            await youtubeDl(url, {
                verbose: true,
                output: outputFile,
                writeInfoJson: true,
            });
            return outputFile;
        } catch (error) {
            throw new Error("Failed to download media");
        }
    }

    public async downloadVideo(videoInfo: any): Promise<string> {
        const videoId = this.getVideoId(videoInfo.webpage_url);
        const outputFile = path.join(this.dataDir, `${videoId}.mp4`);

        // if it already exists, return it
        if (fs.existsSync(outputFile)) {
            return outputFile;
        }

        try {
            await youtubeDl(videoInfo.webpage_url, {
                verbose: true,
                output: outputFile,
                format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                writeInfoJson: true,
            });
            return outputFile;
        } catch (error) {
            throw new Error("Failed to download video");
        }
    }

    public async processVideo(
        url: string,
        runtime: any
    ): Promise<any> {
        this.queue.push(url);
        this.processQueue(runtime);

        return new Promise((resolve, reject) => {
            const checkQueue = async () => {
                const index = this.queue.indexOf(url);
                if (index !== -1) {
                    setTimeout(checkQueue, 100);
                } else {
                    try {
                        const result = await this.processVideoFromUrl(
                            url,
                            runtime
                        );
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                }
            };
            checkQueue();
        });
    }

    private async processQueue(runtime: any): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const url = this.queue.shift()!;
            await this.processVideoFromUrl(url, runtime);
        }

        this.processing = false;
    }

    private async processVideoFromUrl(
        url: string,
        runtime: any
    ): Promise<any> {
        const videoId =
            url.match(
                /(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([^\/&?]+)/ // eslint-disable-line
            )?.[1] || "";
        const videoUuid = this.getVideoId(videoId);
        const cacheKey = `${this.cacheKey}/${videoUuid}`;

        const cached = await runtime.cacheManager.get(cacheKey);

        if (cached) {
            return cached;
        }

        const videoInfo = await this.fetchVideoInfo(url);
        const transcript = await this.getTranscript(url, videoInfo, runtime);

        const result: any = {
            id: videoUuid,
            url: url,
            title: videoInfo.title,
            source: videoInfo.channel,
            description: videoInfo.description,
            text: transcript,
        };

        await runtime.cacheManager.set(cacheKey, result);

        return result;
    }

    private getVideoId(url: string): string {
        // Simple hash function instead of stringToUuid
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    async fetchVideoInfo(url: string): Promise<any> {
        if (url.endsWith(".mp4") || url.includes(".mp4?")) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    // If the URL is a direct link to an MP4 file, return a simplified video info object
                    return {
                        title: path.basename(url),
                        description: "",
                        channel: "",
                    };
                }
            } catch (error) {
                // Fall back to using youtube-dl if direct download fails
            }
        }

        try {
            const result = await youtubeDl(url, {
                dumpJson: true,
                verbose: true,
                callHome: false,
                noCheckCertificates: true,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true,
                writeSub: true,
                writeAutoSub: true,
                subLang: "en",
                skipDownload: true,
            });
            return result;
        } catch (error) {
            throw new Error("Failed to fetch video information");
        }
    }

    private async getTranscript(
        url: string,
        videoInfo: any,
        runtime: any
    ): Promise<string> {
        try {
            // Check for manual subtitles
            if (videoInfo.subtitles && videoInfo.subtitles.en) {
                const srtContent = await this.downloadSRT(
                    videoInfo.subtitles.en[0].url
                );
                return this.parseSRT(srtContent);
            }

            // Check for automatic captions
            if (
                videoInfo.automatic_captions &&
                videoInfo.automatic_captions.en
            ) {
                const captionUrl = videoInfo.automatic_captions.en[0].url;
                const captionContent = await this.downloadCaption(captionUrl);
                return this.parseCaption(captionContent);
            }

            // Check if it's a music video
            if (
                videoInfo.categories &&
                videoInfo.categories.includes("Music")
            ) {
                return "No lyrics available.";
            }

            // Fall back to audio transcription
            return this.transcribeAudio(url, runtime);
        } catch (error) {
            throw error;
        }
    }

    private async downloadCaption(url: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(
                `Failed to download caption: ${response.statusText}`
            );
        }
        return await response.text();
    }

    private parseCaption(captionContent: string): string {
        try {
            const jsonContent = JSON.parse(captionContent);
            if (jsonContent.events) {
                return jsonContent.events
                    .filter((event: any) => event.segs)
                    .map((event: any) => event.segs.map((seg: any) => seg.utf8).join(""))
                    .join("")
                    .replace("\n", " ");
            } else {
                return "Error: Unable to parse captions";
            }
        } catch (error) {
            return "Error: Unable to parse captions";
        }
    }

    private parseSRT(srtContent: string): string {
        // Simple SRT parser (replace with a more robust solution if needed)
        return srtContent
            .split("\n\n")
            .map((block) => block.split("\n").slice(2).join(" "))
            .join(" ");
    }

    private async downloadSRT(url: string): Promise<string> {
        const response = await fetch(url);
        return await response.text();
    }

    async transcribeAudio(
        url: string,
        runtime: any
    ): Promise<string> {
        const mp4FilePath = path.join(
            this.dataDir,
            `${this.getVideoId(url)}.mp4`
        );

        const mp3FilePath = path.join(
            this.dataDir,
            `${this.getVideoId(url)}.mp3`
        );

        if (!fs.existsSync(mp3FilePath)) {
            if (fs.existsSync(mp4FilePath)) {
                await this.convertMp4ToMp3(mp4FilePath, mp3FilePath);
            } else {
                await this.downloadAudio(url, mp3FilePath);
            }
        }

        const audioBuffer = fs.readFileSync(mp3FilePath);
        const startTime = Date.now();
        const transcriptionService = runtime.getService(
            'TRANSCRIPTION'
        );

        if (!transcriptionService) {
            throw new Error("Transcription service not found");
        }

        const uintBuffer = new Uint8Array(audioBuffer).buffer;
        const transcript = await transcriptionService.transcribe(uintBuffer);

        // Don't delete the MP3 file as it might be needed for future use
        return transcript || "Transcription failed";
    }

    private async convertMp4ToMp3(
        inputPath: string,
        outputPath: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .output(outputPath)
                .noVideo()
                .audioCodec("libmp3lame")
                .on("end", () => {
                    resolve();
                })
                .on("error", (err: any) => {
                    reject(err);
                })
                .run();
        });
    }

    private async downloadAudio(
        url: string,
        outputFile: string
    ): Promise<string> {
        outputFile =
            outputFile ??
            path.join(this.dataDir, `${this.getVideoId(url)}.mp3`);

        try {
            if (url.endsWith(".mp4") || url.includes(".mp4?")) {
                const tempMp4File = path.join(
                    tmpdir(),
                    `${this.getVideoId(url)}.mp4`
                );
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                fs.writeFileSync(tempMp4File, buffer);

                await new Promise<void>((resolve, reject) => {
                    ffmpeg(tempMp4File)
                        .output(outputFile)
                        .noVideo()
                        .audioCodec("libmp3lame")
                        .on("end", () => {
                            fs.unlinkSync(tempMp4File);
                            resolve();
                        })
                        .on("error", (err: any) => {
                            reject(err);
                        })
                        .run();
                });
            } else {
                await youtubeDl(url, {
                    verbose: true,
                    extractAudio: true,
                    audioFormat: "mp3",
                    output: outputFile,
                    writeInfoJson: true,
                });
            }
            return outputFile;
        } catch (error) {
            throw new Error("Failed to download audio");
        }
    }
}
