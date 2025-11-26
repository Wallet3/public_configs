#!/usr/bin/env ts-node

import * as fs from "fs";
import * as path from "path";

import { fileURLToPath } from "url";

interface RpcConfig {
  rpcs: (
    | string
    | {
        url: string;
        tracking?: "none" | "yes" | "limited" | "unspecified";
        trackingDetails?: any;
      }
  )[];
}

interface ExtraRpcs {
  [chainId: string]: RpcConfig;
}

async function main() {
  try {
    console.log("Fetching latest extraRpcs data from GitHub...");

    // 1. 获取远程 JS 文件
    const url =
      "https://raw.githubusercontent.com/DefiLlama/chainlist/refs/heads/main/constants/extraRpcs.js";
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    let content = await response.text();

    // 2. 将 ES6 模块转换为可执行的代码
    // 移除所有 import 语句
    content = content.replace(/^import\s+.*?from\s+.*?;?\s*$/gm, "");

    // 移除所有 export 关键字（包括 export default）
    content = content.replace(/^export\s+default\s+.*?;?\s*$/gm, "");
    content = content.replace(/^export\s+/gm, "");

    // 移除对外部函数的调用（如 mergeDeep）
    content = content.replace(
      /const\s+allExtraRpcs\s*=\s*mergeDeep\([^)]*\)\s*;?/g,
      ""
    );

    // 在代码末尾添加返回语句
    content += "\nreturn extraRpcs;";

    // 3. 使用 Function 构造函数执行代码（比 eval 更安全）
    const extraRpcs: ExtraRpcs = new Function(content)();

    console.log(`Found ${Object.keys(extraRpcs).length} chains`);

    // 4. 处理数据
    const result: { [chainId: string]: string[] } = {};

    for (const [chainId, config] of Object.entries(extraRpcs)) {
      const rpcs = config.rpcs;
      if (!rpcs || !Array.isArray(rpcs)) {
        continue;
      }

      const urls: string[] = [];

      for (const rpc of rpcs) {
        let url: string | null = null;

        if (typeof rpc === "string") {
          // 如果是字符串，直接使用
          url = rpc;
        } else if (typeof rpc === "object" && rpc !== null && "url" in rpc) {
          // 如果是对象，检查是否为 chainId 1 的特殊情况
          if (chainId === "1") {
            // chainId 为 1 时，只添加 tracking 为 'none' 的 url
            if (rpc.tracking === "none") {
              url = rpc.url;
            }
          } else {
            // 其他 chainId，直接使用 url
            url = rpc.url;
          }
        }

        // 只添加以 https 开头的 url
        if (url && url.startsWith("https")) {
          urls.push(url);
        }
      }

      // 将结果添加到 result 对象
      result[chainId] = urls;
    }

    // 5. 写入文件
    const outputPath = path.join(__dirname, "rpc_providers.json");
    const jsonContent = JSON.stringify(result, null, 2);

    fs.writeFileSync(outputPath, jsonContent + "\n");

    console.log(`✓ Successfully updated ${outputPath}`);
    console.log(`  Total chains: ${Object.keys(result).length}`);
    console.log(`  Chain 1 (Ethereum) RPCs: ${result["1"]?.length || 0}`);

    // 6. 更新版本号
    const versionPath = path.join(__dirname, "providers_version");
    let currentVersion = 0;

    // 读取当前版本号
    if (fs.existsSync(versionPath)) {
      try {
        const versionData = Number(fs.readFileSync(versionPath, "utf-8"));
        currentVersion = versionData || 0;
      } catch (e) {
        console.warn("Warning: Failed to read version file, starting from 0");
      }
    }

    // 版本号 +1
    const newVersion = currentVersion + 1;

    // 保存新版本号
    fs.writeFileSync(versionPath, `${newVersion}`);

    console.log(`✓ Version updated: ${currentVersion} → ${newVersion}`);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
