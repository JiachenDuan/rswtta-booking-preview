import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const apiPath = "app/api";
const hiddenApiPath = "app/_api_for_server";

function restoreApi() {
  if (existsSync(hiddenApiPath) && !existsSync(apiPath)) {
    renameSync(hiddenApiPath, apiPath);
  }
}

try {
  rmSync(".next", { recursive: true, force: true });
  rmSync("out", { recursive: true, force: true });

  if (existsSync(apiPath)) {
    restoreApi();
    renameSync(apiPath, hiddenApiPath);
  }

  const result = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      GITHUB_PAGES: "true",
      NEXT_PUBLIC_DEMO_MODE: "true"
    }
  });

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    writeFileSync("out/.nojekyll", "");
  }
} finally {
  restoreApi();
}
