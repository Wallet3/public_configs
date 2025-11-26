# 项目需求

这是一个获取 EVM RPC url 的项目。目的是获取指定 Github repo 的最新数据，并更新 json 文件。以下是操作步骤：

1. 目标 json 文件是 `rpc_providers.json`，其结构是：

```typescript
{
    [chainId: string]: string[]
}
```

2. 访问 `https://raw.githubusercontent.com/DefiLlama/chainlist/refs/heads/main/constants/extraRpcs.js`

3. 获取该文件中名为 `extraRpcs` 的数据结构。

4. 解析`extraRpcs`数据结构，其中的 key 以 chainId 标识，其 value 是如下数据结构

```typescript {
    rpcs: (string |
    {
        url: string,
        tracking?: "none"|"yes"|"limited"|"unspecified", trackingDetails: any
    })[]
    }
```

4. 遍历每一个 key，检查以 `https` 开头的 url，如果是，将该 url 提取出来。最终将新的 chainId 对应的 rpc urls 写入 `rpc_providers.json`。

5. 额外要求：如果 chainId 为 1，则只将 `tracking: 'none'` 的 url 更新到 `rpc_providers.json`。

6. 检查所有 chainId 对应的 url 是否有效（能否返回最新的block number）。

7. 每次更新完成后，自动将名为 `providers_version` 文件的值+1，并保存。