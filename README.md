
# `HiveHyde-Anti` v1.0 安全模块 - 统一开发与集成指南


## 1. 系统概述

`HiveHyde-Anti` 是一套先进的前端反爬虫与API安全解决方案，旨在通过客户端深度感知与动态加密签名，为核心API接口提供强大的、难以被自动化工具攻破的保护层。

### 1.1 设计理念
本系统的核心设计理念是“提高攻击者的成本，使其在经济上不可行”。不追求绝对的、一劳永逸的“无法破解”，而是通过以下策略，将逆向和模拟的门槛提升到极高水平：

*   **动态性**: 系统的密钥、策略、甚至API定义都在持续变化，让静态的逆向成果快速失效。
*   **强绑定**: 将加密签名与真实的、活的浏览器环境及用户行为深度绑定，使脱离真实环境的“黑盒调用”变得极其困难。
*   **智能评估**: 不依赖单一指标，而是通过多维度的信息采集和风险评分模型，对请求的可信度进行综合判断。
*   **隐私保护**: 在采集必要信息的同时，通过加密手段保护用户隐私，避免敏感硬件信息泄露。

### 1.2 核心特性
*   **动态会话密钥**: 摒弃静态密钥，保证密钥泄露的风险窗口极短。
*   **多维环境指纹**: 综合Canvas、WebGL、音频、行为轨迹等数十项数据，构建高区分度的设备画像。
*   **自动化工具探测**: 主动扫描`webdriver`、`沙箱环境`篡改等自动化工具的“作弊”痕迹。
*   **请求完整性与防重放**: HMAC签名保护所有请求参数不被篡改，时间戳+Nonce机制杜绝重放攻击。
*   **透明加密**: 对采集的敏感指纹进行AES动态加密，在保护用户隐私的同时，为后端提供完整的分析数据。


## 2. 系统工作流程

`HiveHyde-Anti` 的运作分为初始化、签名生成和后端验证三个阶段。


1.  **[初始化阶段]** 前端应用启动时，首先调用`HiveHyde.initialize()`。此时，前端JS会向后端的一个专门接口（`POST /warden/init`）请求一个有时效性（如30分钟）的**动态会话密钥 (`session_key`)**。
2.  **[API调用阶段]** 当业务代码发起一个受保护的API请求时，一个请求拦截器（`ApiSentinel`）会捕获该请求。
3.  **[数据采集阶段]** 系统根据当前浏览器环境，动态执行策略，采集包括静态指纹（Canvas等）、动态行为（鼠标轨迹）和异常痕迹（`webdriver`）在内的多维度数据。
4.  **[评估与加密阶段]** `RiskMatrix`模块根据采集到的数据，计算出一个**风险分**。同时，将部分关键指纹数据拼接成一个JSON字符串，并使用`session_key`对其进行**AES加密**。
5.  **[签名阶段]** 系统将时间戳、Nonce、API路径、请求参数、风险分以及**加密前**的原始指纹JSON，共同拼接成一个超长字符串，然后使用`session_key`对其进行**HMAC-SHA256签名**。
6.  **[请求发送阶段]** 拦截器将最终的签名、时间戳、Nonce、会话令牌、风险分以及**加密后**的指纹密文，全部注入到HTTP请求头中，然后将请求发出。
7.  **[后端验证阶段]** 后端收到请求后，执行一个安全中间件：  
    a. 解析所有安全头。  
    b. 根据会话令牌从Redis中取出`session_key`。  
    c. 校验时间戳和Nonce。  
    d. 使用`session_key`**解密**指纹密文，得到原始指纹JSON。  
    e. 用与前端完全相同的逻辑，**重新计算**HMAC签名。  
    f. 对比签名，一致则放行，否则拒绝。  

## 3. 前端工程师集成指南 (Vue.js + axios 示例)

### 3.1 文件部署与依赖
1.  **复制文件**: 将 `hivehyde_anti` 文件夹js文件复制到项目的静态文件存放目录下。
2.  **引入依赖**: 在 `./index.html` 的 `<body>` 标签末尾，**严格按以下顺序**加载所有必需的脚本。

    ```html
    <!-- 1. 外部加密依赖 -->
    <script src="<%= BASE_URL %>hivehyde_anti/crypto-js.min.js"></script>
    <!-- 2. HiveHyde 模块 (顺序至关重要!) -->
    <script src="<%= BASE_URL %>hivehyde_anti/session_vault.js"></script>
    <script src="<%= BASE_URL %>hivehyde_anti/data_loom.js"></script>
    <script src="<%= BASE_URL %>hivehyde_anti/anomaly_scan.js"></script>
    <script src="<%= BASE_URL %>hivehyde_anti/risk_matrix.js"></script>
    <script src="<%= BASE_URL %>hivehyde_anti/core_engine.js"></script>
    <script src="<%= BASE_URL %>hivehyde_anti/api_sentinel.js"></script>
    ```

### 3.2 代码集成（以Vue程序为例）
1.  **配置 `axios` 实例 (e.g., `src/http.js`)**:
    确保你有一个全局的`axios`实例，并导出`setupSecurityInterceptor`函数。

    ```javascript
    // src/http.js
    import axios from 'axios';
    const apiClient = axios.create({
        baseURL: process.env.VUE_APP_API_URL,
        timeout: 15000,
    });
    // ... (其他拦截器)
    export function setupSecurityInterceptor() {
        if (window.HiveHyde && window.HiveHyde.ApiSentinel) {
            window.HiveHyde.ApiSentinel.attachTo(apiClient);
        }
    }
    export default apiClient;
    ```

2.  **在应用入口 (`src/main.js`) 异步初始化**:
    在挂载Vue应用前，必须先等待`HiveHyde`初始化完成。

    ```javascript
    // src/main.js
    import { createApp } from 'vue';
    import App from './App.vue';
    import { setupSecurityInterceptor } from './http.js';

    async function bootstrap() {
        try {
            await window.HiveHyde.initialize({
                apiBaseUrl: process.env.VUE_APP_API_URL
            });
            setupSecurityInterceptor();
        } catch (error) {
            console.error("🔴 Security module failed to initialize.", error.message);
        } finally {
            createApp(App).mount('#app');
        }
    }
    bootstrap();
    ```

### 3.3 使用方法

在任何需要保护的`axios`调用中，添加`protect: true`选项。  

```javascript
import apiClient from '@/http.js';
// 调用受保护的API
apiClient.post('/api/orders', orderData, { protect: true });
```
Demo示例：`demo_normal.html`和`demo_hacker.html`两个页面分别模拟了正常用户和攻击者  
打开`console_debug.js`文件，将内容复制到控制台可以对请求内容分析调试  

## 4. 后端工程师集成指南 (Go 示例)

### 4.1 需实现的接口
#### `POST /warden/init`
*   **功能**: 生成并下发动态会话密钥。
*   **逻辑**:
    1.  生成一个32字节的随机`session_key`（即64位十六进制字符串）。
    2.  生成一个唯一的`session_token`。
    3.  将`(session_token -> session_key)`存入Redis，过期时间设置为30分钟。
    4.  返回以下JSON结构：
        ```json
        {
            "code": 0,
            "data": { "key": "...", "token": "..." },
            "msg": "操作成功"
        }
        ```

### 4.2 需实现的验证中间件
你需要创建一个HTTP中间件，用于保护所有需要签名的业务API。

#### 4.2.1 需解析的HTTP请求头

| Header Name                  | 描述与用途                                                   |
| :--------------------------- | :----------------------------------------------------------- |
| `X-Hive-Signature`           | **最终签名**，用于比对。                                     |
| `X-Hive-Timestamp`           | **时间戳**，用于时间窗口校验（建议30-60秒）。                |
| `X-Hive-Nonce`               | **随机数**，用于在Redis中校验唯一性，防重放。                |
| `X-Hive-Token`               | **会话令牌**，用于在Redis中查找`session_key`。               |
| `X-Hive-RiskScore`           | **前端风险分**，可用于风控决策。                             |
| `X-Hive-Fingerprint-Json`    | **AES加密后的指纹密文** (Base64编码)，需要解密后参与签名计算。 |

#### 4.2.2 验证流程 (Go伪代码)

```go
func HiveAntiMiddleware(redisClient *redis.Client) gin.HandlerFunc {
    return func(c *gin.Context) {
        // 1. 解析所有6个 X-Hive-* 请求头
        signature, timestampStr, nonce, token, riskScoreStr, encryptedFp := ...

        // 2. 校验时间戳 (与服务器时间差是否在窗口内)
        // ...

        // 3. 校验Nonce (在Redis中检查是否存在，不存在则写入)
        // ...

        // 4. 获取会话密钥
        sessionKey, err := redisClient.Get(c, "hive_session:"+token).Result()
        if err != nil { /* 令牌无效 */ }

        // 5. 【核心】解密指纹数据
        fingerprintJson, err := AesDecryptGo(encryptedFp, sessionKey) // 见下文解密函数
        if err != nil { /* 解密失败 */ }

        // 6. 【核心】重新计算签名
        //    a. 拼接与前端完全一致的 dataToSign 字符串
        //    b. 使用 sessionKey 进行 HMAC-SHA256 计算
        serverSignature := calculateServerSignature(c, sessionKey, fingerprintJson)

        // 7. 安全地比对签名
        if !hmac.Equal([]byte(signature), []byte(serverSignature)) {
            c.AbortWithStatusJSON(401, gin.H{"code": 40101, "msg": "签名无效"})
            return
        }

        c.Next()
    }
}
```

#### 4.2.3 `dataToSign` 拼接规则 (必须严格遵守)
使用`||`作为分隔符，拼接以下7个组件：
`[timestamp]||[nonce]||[httpMethod]||[realUrl]||[serializedParams]||[riskScore]||[fingerprintJson]`

*   `httpMethod`必须为大写。
*   `realUrl`为纯路径，不带域名和参数。
*   `serializedParams`：
    *   **GET**: Query参数按key字母序排序后，以`key=value`格式用`&`拼接。
    *   **POST/PUT (JSON Body)**: 如果Body为空，则为字符串`"{}"`。如果不为空，则为紧凑的、**key按字母序排序**的JSON字符串（Canonical JSON）。
*   `fingerprintJson`：**使用解密后的明文字符串**。

#### 4.2.4 AES解密参数

*   **算法**: `AES-256-CBC`
*   **密钥 (Key)**: 从Redis获取的`session_key`（解码为32字节二进制）。
*   **初始向量 (IV)**: `session_key`的**前16个字节**。
*   **填充 (Padding)**: `PKCS7`
*   **输入编码**: Base64

---

## 5. 附录：Q&A

*   **Q: 为什么登录接口也需要保护？**
    *   A: 为了防止攻击者在登录环节就使用自动化脚本进行暴力破解或撞库。通过在登录时就进行环境检测，可以过滤掉大量非人类的登录尝试。
*   **Q: 联调时遇到“签名无效”怎么办？**
    *   A: 这是最常见的联调问题。请严格按照本文档的`dataToSign`拼接规则，在前后端同时打印出最终用于签名的那个长字符串，然后使用文本比对工具找出差异点。问题99%都出在这里。
*   **Q: 遇到“凭证已过期”怎么办？**
    *   A: 这通常是开发电脑与后端服务器时间不同步导致的。请校准时间，或者在开发阶段临时放宽后端的时间窗口（`time_window_ms`）。
