import {
    VideoService,
} from "./services/video";


const browserPlugin = {
  name: "default",
  description: "Default plugin, with basic actions and evaluators",
  services: [new VideoService()],
  actions: [],
};

export default browserPlugin;