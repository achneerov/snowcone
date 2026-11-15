import { open } from 'node:fs/promises';

async function* readLines(path) {
  const file = await open(path, 'r');

  try {
    for await (const line of file.readLines({ autoClose: false })) {
      yield line;
    }
  } finally {
    await file.close();
  }
}

export default readLines;
