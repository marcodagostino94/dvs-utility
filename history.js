export function filterHistoryItems(items, reportType, query = "") {
  const normalizedType = ["audio", "video", "episode"].includes(reportType) ? reportType : "audio";
  const normalizedQuery = String(query).trim().toLocaleLowerCase("it");
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemType = ["audio", "video", "episode"].includes(item?.report_type) ? item.report_type : "audio";
    if (itemType !== normalizedType) return false;
    return !normalizedQuery || String(item?.title || "").toLocaleLowerCase("it").includes(normalizedQuery);
  });
}
