# 北京食单

北京一人食收藏地图。保留真实菜品照片、店铺位置和出处，支持记录一餐、点赞和评价，可直接部署到腾讯云等 Linux 服务器。

## 功能

- Leaflet 地图、GeoJSON 店铺位置与 Canvas 参考范围；悬停显示首图和店名，点击查看菜品。
- 投稿仅需完整店名（含分店）、地址、菜品和 1–3 张菜品图；体验、人均、日期和来源链接选填。
- 每个账号可点赞／取消，同一店铺的不同用餐记录各自保留反馈；评价可自述实际到店体验。
- SQLite 持久化账号、投稿、点赞、评价和图片元数据，受控文件目录保存图片。部署升级不会覆盖数据。
- 自主账号登录、邀请注册、服务器会话、CSRF 校验和登录限流。默认私有浏览，可配置公开浏览、登录后写入。

## 本地运行

需要 Node.js 22.18 或更高版本，以及 pnpm。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm build
pnpm start
```

默认地址是 `http://127.0.0.1:8790/`。初次运行按 Drizzle 迁移创建数据库；已应用迁移按哈希校验，不允许改写历史迁移。

首次账号通过 `pnpm user:create` 从标准输入读取 JSON：`username`、`password`、`displayName`。用户名 3–32 位小写英文／数字／下划线／短横线，密码至少 12 字符。避免把密码放在 shell 参数或 Git 中。设置私密 `REGISTRATION_CODE` 后，可以在登录页面邀请注册；留空则关闭自助注册。

测试：`pnpm test`。测试使用独立临时目录，覆盖真实持久化、点赞与投稿去重、图片所有权、认证、CSRF、事务回滚、迁移完整性和路径限制。

## 腾讯云部署

推荐结构：

- `/opt/beijing-food-map/releases/<commit>/`：代码版本。
- `/opt/beijing-food-map/current`：当前版本软链接。
- `/var/lib/beijing-food-map/`：数据库及图片，归独立 `foodmap` 用户所有。
- `/etc/beijing-food-map.env`：服务器配置，权限 `0600`，仅管理员读取。

1. 构建并上传源码和 `dist`，安装锁定的生产依赖。
2. 将 `.env.example` 的配置写入服务器专用配置文件；`APP_ORIGIN` 为真实 HTTPS 域名或已配置证书的 IP，`BASE_PATH=/food/`。
3. 使用 `deploy/beijing-food-map.service` 启动独立 systemd 服务，Node 只监听 `127.0.0.1:8790`。
4. 将 `deploy/nginx-food.conf` 包含在现有 HTTPS server 中；运行 `nginx -t` 成功后 reload。模板保留 `/food/` 前缀给 Node 处理，不占用现有根路径。
5. 使用 `deploy/backup.mjs` 备份数据库与图片，升级前先备份；回滚切换代码软链接即可，数据库迁移保持追加。

## 源码与数据边界

`public/` 包含整理后的 65 家店铺、76 张网页照片和必要出处；源链接去除了短期验证参数。原始研究记录、OCR、未确认帖子、平台配置、会话、上传数据、缓存和凭据不在公共仓库中。

店铺和照片整理于 2026-10-04。店铺信息会变化，地图上的参考位置不等同于实时导航。照片来自其对应原帖，原作者保留照片权利；图库与代码的使用权需分别处理。

`worker/index.js` 保留食单业务逻辑，通过小型 SQLite／文件存储适配器运行于 Node。身份由本站会话验证后传入，不依赖或信任浏览器提供的平台身份标头。原 Sites 部署与此服务器版本相互独立，原数据库中的正式用户数据需要单独迁移。
