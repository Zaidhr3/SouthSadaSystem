// خارج Next (سكربتات التشخيص على الجهاز فقط): تعطيل حارس server-only
import Module from "node:module";
const req = Module.createRequire(__filename);
req.cache[req.resolve("server-only")] = { id: "server-only", exports: {}, loaded: true } as unknown as NodeJS.Module;
