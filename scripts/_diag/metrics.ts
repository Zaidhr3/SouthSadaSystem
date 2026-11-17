import "../load-env";
import "../no-server-only";
import { callMeta, getMetaConfig } from "../../src/lib/meta";
const tryit = async (l: string, f: () => Promise<unknown>) => { try { console.log(l, JSON.stringify(await f()).slice(0, 400)); } catch (e) { console.log(l, "ERR", (e as Error).message.slice(0, 200)); } };
(async () => {
  const cfg = (await getMetaConfig())!;
  const fb: any = await callMeta("GET", `${cfg.pageId}/posts`, { fields: "id,created_time,status_type,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares", limit: "3" });
  console.log("FB", JSON.stringify(fb.data).slice(0, 500));
  const pid = fb.data[0].id;
  for (const m of ["post_impressions_unique", "post_media_view", "post_total_media_view_unique", "post_clicks", "post_video_views"]) await tryit("fb " + m, () => callMeta("GET", `${pid}/insights`, { metric: m }));
  const ig: any = await callMeta("GET", `${cfg.igUserId}/media`, { fields: "id,media_type,media_product_type,like_count,comments_count,timestamp", limit: "5" });
  console.log("IG", JSON.stringify(ig.data).slice(0, 500));
  const mid = ig.data[0].id;
  for (const m of ["reach", "views", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"]) await tryit("ig " + m, () => callMeta("GET", `${mid}/insights`, { metric: m }));
  await tryit("ad accounts", () => callMeta("GET", "me/adaccounts", { fields: "id,name,account_status,currency" }));
  await tryit("followers", () => callMeta("GET", `${cfg.igUserId}`, { fields: "followers_count,media_count,username" }));
  await tryit("page fans", () => callMeta("GET", `${cfg.pageId}`, { fields: "followers_count,fan_count,name" }));
  process.exit(0);
})();
