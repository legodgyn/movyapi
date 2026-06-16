export const config = {
  apiUrl: import.meta.env.VITE_API_URL || "https://api.scaleapi.com.br",
  localBackendUrl:
    import.meta.env.VITE_LOCAL_BACKEND_URL ||
    "http://127.0.0.1:5174",
  infobipGatewayUrl:
    import.meta.env.VITE_INFOBIP_GATEWAY_URL ||
    "https://automacoes-infobip-crack.fnyqhf.easypanel.host",
  supabaseUrl:
    import.meta.env.VITE_SUPABASE_URL || "https://hrnciimcoxlhnjrnfuzw.supabase.co",
};

export const apiBaseUrl = `${config.apiUrl.replace(/\/$/, "")}/api/v1`;
