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

/**
 * 检查 RPC URL 是否有效（能否返回最新的 block number）
 */
async function checkRpcUrl(url: string, timeout: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    // 检查是否有有效的 result
    if (data.result && typeof data.result === 'string' && data.result.startsWith('0x')) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

/**
 * 并发检查多个 RPC URLs
 */
async function checkRpcUrls(urls: string[], concurrency: number = 10): Promise<string[]> {
  const validUrls: string[] = [];
  const chunks: string[][] = [];

  // 将 URLs 分成多个批次
  for (let i = 0; i < urls.length; i += concurrency) {
    chunks.push(urls.slice(i, i + concurrency));
  }

  // 逐批次检查
  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (url) => {
        const isValid = await checkRpcUrl(url);
        return { url, isValid };
      })
    );

    // 收集有效的 URLs
    for (const { url, isValid } of results) {
      if (isValid) {
        validUrls.push(url);
      }
    }
  }

  return validUrls;
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

    console.log(`\nValidating RPC URLs...`);
    console.log(`Total chains to validate: ${Object.keys(result).length}`);

    // 6. 验证所有 RPC URLs
    const validatedResult: { [chainId: string]: string[] } = {};
    let totalUrls = 0;
    let validUrls = 0;
    let processedChains = 0;

    for (const [chainId, urls] of Object.entries(result)) {
      if (urls.length === 0) {
        validatedResult[chainId] = [];
        continue;
      }

      totalUrls += urls.length;
      processedChains++;

      process.stdout.write(
        `\rValidating chain ${chainId} (${processedChains}/${Object.keys(result).length}): ${urls.length} URLs...`
      );

      const validUrlsForChain = await checkRpcUrls(urls, 30);
      validatedResult[chainId] = validUrlsForChain;
      validUrls += validUrlsForChain.length;
    }

    console.log(
      `\n✓ Validation complete: ${validUrls}/${totalUrls} URLs are valid (${((validUrls / totalUrls) * 100).toFixed(1)}%)`
    );

    // 7. 写入文件
    const outputPath = path.join(__dirname, "rpc_providers.json");
    const jsonContent = JSON.stringify(validatedResult, null, 2);

    fs.writeFileSync(outputPath, jsonContent + "\n");

    console.log(`✓ Successfully updated ${outputPath}`);
    console.log(`  Total chains: ${Object.keys(validatedResult).length}`);
    console.log(`  Chain 1 (Ethereum) RPCs: ${validatedResult["1"]?.length || 0}`);

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
