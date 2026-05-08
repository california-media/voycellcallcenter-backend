const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";

module.exports = {
  META_GRAPH_URL:     `https://graph.facebook.com/${META_GRAPH_VERSION}`,
  META_GRAPH_VERSION,
};
