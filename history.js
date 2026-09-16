export function filterHistoryItems(items, reportType, query = "") {
  const normalizedType = reportType === "video" ? "video" : "audio";
  const normalizedQuery = String(query).trim().toLocaleLowerCase("it");
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemType = item?.report_type === "video" ? "video" : "audio";
    if (itemType !== normalizedType) return false;
    return !normalizedQuery || String(item?.title || "").toLocaleLowerCase("it").includes(normalizedQuery);
  });
}
