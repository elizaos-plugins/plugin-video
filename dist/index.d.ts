declare class VideoService {
    static serviceType: string;
    private cacheKey;
    private dataDir;
    private queue;
    private processing;
    constructor();
    static getInstance(): VideoService;
    getInstance(): VideoService;
    initialize(_runtime: any): Promise<void>;
    private ensureDataDirectoryExists;
    isVideoUrl(url: string): boolean;
    downloadMedia(url: string): Promise<string>;
    downloadVideo(videoInfo: any): Promise<string>;
    processVideo(url: string, runtime: any): Promise<any>;
    private processQueue;
    private processVideoFromUrl;
    private getVideoId;
    fetchVideoInfo(url: string): Promise<any>;
    private getTranscript;
    private downloadCaption;
    private parseCaption;
    private parseSRT;
    private downloadSRT;
    transcribeAudio(url: string, runtime: any): Promise<string>;
    private convertMp4ToMp3;
    private downloadAudio;
}

declare const browserPlugin: {
    name: string;
    description: string;
    services: VideoService[];
    actions: never[];
};

export { browserPlugin as default };
