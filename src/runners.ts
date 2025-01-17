import Docker, { Container } from "dockerode";
import { Language } from "./constants";
import logger from "./logger";

type SendReply = (reply: string) => Promise<unknown>;

const socketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

export const docker = new Docker({ socketPath });

const images = {
  [Language.Python]: "python:3.10-alpine",
  [Language.JavaScript]: "node:18-alpine",
};

export async function pullImages() {
  const promises = Object.values(images).map((image) => docker.pull(image));
  await Promise.all(promises);
}

async function runCodeInContainer(
  language: Language,
  cmd: string[],
  sendReply: SendReply
) {
  let container: Container | undefined;

  try {
    container = await docker.createContainer({
      Image: images[language],
      Cmd: cmd,
      StopTimeout: 1,
      Tty: true,
    });
    const timeout = setTimeout(() => {
      try {
        if (container) {
          sendReply("Container timed out.");
          container.stop();
        }
      } catch (e) {
        logger.error(e);
      }
    }, 3000);
    await container.start();
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });
    const output = await new Promise<string>((resolve) => {
      let output = "";
      stream.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf-8");
      });
      stream.on("end", () => {
        resolve(output);
      });
    });
    clearTimeout(timeout);
    return output.trim();
  } finally {
    if (container) {
      await container.remove({ force: true });
    }
  }
}

async function runPythonCode(code: string, sendReply: SendReply) {
  return runCodeInContainer(Language.Python, ["python", "-c", code], sendReply);
}

async function runJavaScriptCode(code: string, sendReply: SendReply) {
  return runCodeInContainer(
    Language.JavaScript,
    ["node", "-e", code],
    sendReply
  );
}

export async function run(
  language: Language,
  code: string,
  sendReply: SendReply
) {
  switch (language) {
    case Language.Python:
      return runPythonCode(code, sendReply);
    case Language.JavaScript:
      return runJavaScriptCode(code, sendReply);
  }
}
