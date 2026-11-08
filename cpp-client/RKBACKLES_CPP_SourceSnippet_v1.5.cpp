



#ifndef NOMINMAX
#define NOMINMAX  // Prevent windows.h min/max macros from breaking std::min/std::max.
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#define CURL_STATICLIB
#define STB_IMAGE_IMPLEMENTATION 

#pragma comment(lib, "Ws2_32.lib")
#pragma comment(lib, "Wldap32.lib")
#pragma comment(lib, "Crypt32.lib")
#pragma comment(lib, "Normaliz.lib")
#pragma comment(lib, "libcrypto.lib")
#pragma comment(lib, "libssl.lib")
#pragma comment(lib, "d3d11.lib")

#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <ctime>
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <windows.h>
#include <d3d11.h>
#include <atomic>
#include <mutex>
#include <vector>
#include <memory>

#include "imgui.h"
#include "imgui_internal.h"
#include "stb_image.h"

using json = nlohmann::json;
std::once_flag g_CurlInitFlag;

// ==========================================
// 1. Firebase Configuration & Global Variables
// ==========================================
const std::string DATABASE_URL = "https://rkbackles-default-rtdb.firebaseio.com";
// Public Firebase Web API key (not a service-account secret). Keep this in sync with firebase/web-config.js.
const std::string FIREBASE_WEB_API_KEY = "AIzaSyBhvl3fgS7uXA1lWcAWlwvbK8bh-nEJkzw";
// Replace with the HTTPS origin of the deployed RKBACKLES Discord Bot service.
const std::string CPP_API_BASE_URL = "https://YOUR-RKBACKLES-SERVICE.onrender.com"; // Must be the deployed Bot base URL, no trailing slash.

extern ID3D11Device* g_pd3dDevice;
ID3D11ShaderResourceView* g_AvatarTexture = nullptr;
int g_AvatarWidth = 0;
int g_AvatarHeight = 0;
std::atomic<bool> g_IsLoadingAvatar(false);

std::atomic<bool> authed(false);
std::atomic<bool> g_StopSyncThread(false);
std::mutex g_AuthMutex;
std::mutex g_ProfileMutex;
std::mutex g_ProfileCacheMutex;
std::mutex g_SyncThreadMutex;
std::thread g_RealtimeSyncWorker;
std::string g_CppUid;
std::string g_FirebaseIdToken;
std::string g_FirebaseRefreshToken;
std::string g_AppSessionId;
uint64_t g_FirebaseTokenExpiresAtMs = 0;
json g_CppProfileCache = json::object();

std::string btn_user_txt = "User Login";
std::string btn_dev_txt = "Dev Login";

char KeyAuth_USER_user_char[256] = "";
char KeyAuth_USER_pass_char[256] = "";
char KeyAuth_DEV_key_char[256] = "";

struct UserProfile {
    std::string username = "";
    std::string maskedPassword = "";
    std::string status = "";
    std::string category = "";
    std::string avatarUrl = "";
    std::string serverName = "";
    std::string usedKey = "";
    uint64_t expiresAt = 0;
    long long remainingDays = 0;
    bool isDevKeyUser = false;
} g_CurrentUser;

// Forward declarations
void StartRealtimeSyncThread();
void StopRealtimeSyncThread();
void FetchAvatarAsync(const std::string& url, ID3D11Device* d3dDevice);
UserProfile GetCurrentUserSnapshot();
void LogoutCppSession();

// ==========================================
// 2. Hardware ID (HWID) Generator
// ==========================================
std::string GetSystemHWID() {
    char volumeName[MAX_PATH + 1] = { 0 };
    char fileSystemName[MAX_PATH + 1] = { 0 };
    DWORD serialNumber = 0;
    DWORD maxComponentLen = 0;
    DWORD fileSystemFlags = 0;

    if (GetVolumeInformationA("C:\\", volumeName, ARRAYSIZE(volumeName), &serialNumber, &maxComponentLen, &fileSystemFlags, fileSystemName, ARRAYSIZE(fileSystemName))) {
        return std::to_string(serialNumber);
    }
    return "UNKNOWN_HWID";
}

// ==========================================
// 3. Network & Firebase Helper Functions
// ==========================================
static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    const size_t totalSize = size * nmemb;
    if (userp && contents && totalSize > 0) static_cast<std::string*>(userp)->append(static_cast<char*>(contents), totalSize);
    return totalSize;
}

std::string UrlEncode(const std::string& value) {
    CURL* curl = curl_easy_init();
    if (!curl) return value;
    char* encoded = curl_easy_escape(curl, value.c_str(), static_cast<int>(value.size()));
    std::string result = encoded ? encoded : value;
    if (encoded) curl_free(encoded);
    curl_easy_cleanup(curl);
    return result;
}

bool PerformHTTPRequestEx(const std::string& url, const std::string& method, const std::string& body,
                          std::string& response, const std::string& bearerToken = "",
                          const std::string& contentType = "application/json", long timeoutMs = 8000,
                          long* outHttpCode = nullptr) {
    response.clear();
    std::call_once(g_CurlInitFlag, []() { curl_global_init(CURL_GLOBAL_DEFAULT); });
    CURL* curl = curl_easy_init();
    if (!curl) return false;

    curl_slist* headers = nullptr;
    const std::string contentHeader = "Content-Type: " + contentType;
    headers = curl_slist_append(headers, contentHeader.c_str());
    if (bearerToken.size() > 0) {
        const std::string authHeader = "Authorization: Bearer " + bearerToken;
        headers = curl_slist_append(headers, authHeader.c_str());
    }
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    // Never disable certificate validation: custom auth tokens and account data cross this connection.
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 5000L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    if (method == "POST") {
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    } else if (method == "PATCH" || method == "PUT" || method == "DELETE") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str());
        if (method != "DELETE") {
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
        }
    }

    const CURLcode result = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
    if (outHttpCode) *outHttpCode = httpCode;
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return result == CURLE_OK && httpCode >= 200 && httpCode < 300;
}

bool PerformHTTPRequest(const std::string& url, const std::string& method, const std::string& body, std::string& response) {
    return PerformHTTPRequestEx(url, method, body, response);
}

std::string GetFirebaseIdToken() {
    std::lock_guard<std::mutex> lock(g_AuthMutex);
    return g_FirebaseIdToken;
}

bool ServerRequest(const std::string& path, const json& body, std::string& response, long* outHttpCode = nullptr) {
    const std::string token = GetFirebaseIdToken();
    const std::string url = CPP_API_BASE_URL + path;
    return PerformHTTPRequestEx(url, "POST", body.dump(), response, token, "application/json", 8000, outHttpCode);
}

bool ExchangeCustomTokenForFirebaseToken(const std::string& customToken, std::string& err) {
    json payload = { {"token", customToken}, {"returnSecureToken", true} };
    std::string response;
    long status = 0;
    const std::string url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + FIREBASE_WEB_API_KEY;
    if (!PerformHTTPRequestEx(url, "POST", payload.dump(), response, "", "application/json", 10000, &status)) {
        err = "Firebase token exchange failed (HTTP " + std::to_string(status) + "). Check the Web API key and Firebase Auth configuration.";
        return false;
    }
    try {
        const json data = json::parse(response);
        const std::string idToken = data.value("idToken", std::string());
        const std::string refreshToken = data.value("refreshToken", std::string());
        const uint64_t expiresIn = data.value("expiresIn", std::string("3600")).empty()
            ? 3600 : std::stoull(data.value("expiresIn", std::string("3600")));
        if (idToken.empty() || refreshToken.empty()) {
            err = "Firebase token response was incomplete.";
            return false;
        }
        {
            std::lock_guard<std::mutex> lock(g_AuthMutex);
            g_FirebaseIdToken = idToken;
            g_FirebaseRefreshToken = refreshToken;
            g_FirebaseTokenExpiresAtMs = static_cast<uint64_t>(std::time(nullptr)) * 1000ULL + expiresIn * 1000ULL;
        }
        return true;
    } catch (const std::exception&) {
        err = "Could not parse Firebase token response.";
        return false;
    }
}

bool RefreshFirebaseIdToken() {
    std::string refreshToken;
    {
        std::lock_guard<std::mutex> lock(g_AuthMutex);
        refreshToken = g_FirebaseRefreshToken;
    }
    if (refreshToken.empty()) return false;
    const std::string body = "grant_type=refresh_token&refresh_token=" + UrlEncode(refreshToken);
    std::string response;
    long status = 0;
    const std::string url = "https://securetoken.googleapis.com/v1/token?key=" + FIREBASE_WEB_API_KEY;
    if (!PerformHTTPRequestEx(url, "POST", body, response, "", "application/x-www-form-urlencoded", 8000, &status)) return false;
    try {
        const json data = json::parse(response);
        const std::string idToken = data.value("id_token", std::string());
        const std::string newRefresh = data.value("refresh_token", refreshToken);
        const uint64_t expiresIn = std::stoull(data.value("expires_in", std::string("3600")));
        if (idToken.empty()) return false;
        std::lock_guard<std::mutex> lock(g_AuthMutex);
        g_FirebaseIdToken = idToken;
        g_FirebaseRefreshToken = newRefresh;
        g_FirebaseTokenExpiresAtMs = static_cast<uint64_t>(std::time(nullptr)) * 1000ULL + expiresIn * 1000ULL;
        return true;
    } catch (...) { return false; }
}

void SendLogToFirebase(const std::string& logType, const std::string& username, const std::string& details) {
    // Route logs through the authenticated server bridge; never write to a public RTDB path from the client.
    std::thread([logType, username, details]() {
        json payload = { {"type", logType}, {"username", username}, {"details", details} };
        std::string response;
        long status = 0;
        ServerRequest("/api/cpp/log", payload, response, &status);
    }).detach();
}

void StartDigitalSessionLoop(const std::string&) {
    // Heartbeat is sent by the same SSE worker every connection cycle; no detached competing writer is needed.
}

long long CalculateRemainingDays(uint64_t expiresAtMs) {
    uint64_t currentTimestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();

    if (expiresAtMs <= currentTimestamp) return 0;
    uint64_t diffMs = expiresAtMs - currentTimestamp;
    return (diffMs / (1000LL * 60LL * 60LL * 24LL));
}

UserProfile GetCurrentUserSnapshot() {
    std::lock_guard<std::mutex> lock(g_ProfileMutex);
    return g_CurrentUser;
}

void UpdateCurrentUserFromProfile(const json& profile) {
    std::string latestAvatar;
    bool revokeAccess = profile.value("accessRevoked", false);
    {
        std::lock_guard<std::mutex> lock(g_ProfileMutex);
        const std::string oldAvatar = g_CurrentUser.avatarUrl;
        g_CurrentUser.username = profile.value("username", g_CurrentUser.username);
        g_CurrentUser.status = profile.value("status", g_CurrentUser.status);
        g_CurrentUser.category = profile.value("category", g_CurrentUser.category);
        g_CurrentUser.avatarUrl = profile.value("avatarUrl", g_CurrentUser.avatarUrl);
        g_CurrentUser.serverName = profile.value("serverName", g_CurrentUser.serverName);
        g_CurrentUser.usedKey = profile.value("usedKey", g_CurrentUser.usedKey);
        g_CurrentUser.isDevKeyUser = profile.value("isDevKeyUser", g_CurrentUser.isDevKeyUser);
        g_CurrentUser.expiresAt = profile.value("expiresAt", g_CurrentUser.expiresAt);
        g_CurrentUser.remainingDays = g_CurrentUser.isDevKeyUser && g_CurrentUser.expiresAt == 0 ? 999 : CalculateRemainingDays(g_CurrentUser.expiresAt);
        g_CurrentUser.maskedPassword = g_CurrentUser.isDevKeyUser ? "" : "***";
        latestAvatar = g_CurrentUser.avatarUrl != oldAvatar ? g_CurrentUser.avatarUrl : "";
    }
    if (!latestAvatar.empty() && g_pd3dDevice) {
        std::thread(FetchAvatarAsync, latestAvatar, g_pd3dDevice).detach();
    }
    if (revokeAccess) {
        authed = false;
        g_StopSyncThread = true;
    }
}

bool LoadTextureFromMemory(const void* data, size_t size, ID3D11Device* d3dDevice, ID3D11ShaderResourceView** out_srv, int* out_width, int* out_height) {
    if (!d3dDevice || !data || size == 0) return false;

    int image_width = 0, image_height = 0;
    unsigned char* image_data = stbi_load_from_memory((const stbi_uc*)data, (int)size, &image_width, &image_height, NULL, 4);
    if (image_data == NULL) return false;

    D3D11_TEXTURE2D_DESC desc;
    ZeroMemory(&desc, sizeof(desc));
    desc.Width = image_width;
    desc.Height = image_height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;

    ID3D11Texture2D* pTexture = NULL;
    D3D11_SUBRESOURCE_DATA subResource;
    subResource.pSysMem = image_data;
    subResource.SysMemPitch = desc.Width * 4;
    subResource.SysMemSlicePitch = 0;

    if (FAILED(d3dDevice->CreateTexture2D(&desc, &subResource, &pTexture))) {
        stbi_image_free(image_data);
        return false;
    }

    D3D11_SHADER_RESOURCE_VIEW_DESC srvDesc;
    ZeroMemory(&srvDesc, sizeof(srvDesc));
    srvDesc.Format = desc.Format;
    srvDesc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
    srvDesc.Texture2D.MostDetailedMip = 0;
    srvDesc.Texture2D.MipLevels = 1;

    ID3D11ShaderResourceView* newSrv = nullptr;
    if (SUCCEEDED(d3dDevice->CreateShaderResourceView(pTexture, &srvDesc, &newSrv))) {
        // পুরোনো Texture মেমোরি থেকে Release করা
        if (*out_srv) {
            (*out_srv)->Release();
            *out_srv = nullptr;
        }
        *out_srv = newSrv;
        *out_width = image_width;
        *out_height = image_height;
    }

    pTexture->Release();
    stbi_image_free(image_data);
    return true;
}

void FetchAvatarAsync(const std::string& url, ID3D11Device* d3dDevice) {
    if (url.empty() || !d3dDevice) return;
    g_IsLoadingAvatar = true;

    // 🔥 Cache Bypass: URL-এ ইউনিক কুয়েরি পারামিটার যোগ
    std::string freshUrl = url;
    if (freshUrl.find("?") != std::string::npos) {
        freshUrl += "&nocache=" + std::to_string(std::time(0));
    }
    else {
        freshUrl += "?nocache=" + std::to_string(std::time(0));
    }

    std::string imageBytes;
    if (PerformHTTPRequest(freshUrl, "GET", "", imageBytes)) {
        // LoadTextureFromMemory অটোমেটিক আগের পিক্সেল মেমোরি ফ্রী করে নতুন ছবি টেক্সচারে লোড করবে
        LoadTextureFromMemory(imageBytes.data(), imageBytes.size(), d3dDevice, &g_AvatarTexture, &g_AvatarWidth, &g_AvatarHeight);
    }
    g_IsLoadingAvatar = false;
}

namespace {
struct SseContext {
    std::string buffer;
    std::string uid;
};

void SetJsonAtPath(json& target, const std::string& path, const json& value) {
    if (path.empty() || path == "/") {
        target = value;
        return;
    }
    std::vector<std::string> parts;
    std::stringstream stream(path);
    std::string item;
    while (std::getline(stream, item, '/')) if (!item.empty()) parts.push_back(item);
    if (parts.empty()) { target = value; return; }
    json* cursor = &target;
    for (size_t i = 0; i + 1 < parts.size(); ++i) {
        if (!cursor->is_object()) *cursor = json::object();
        if (!cursor->contains(parts[i]) || !(*cursor)[parts[i]].is_object()) (*cursor)[parts[i]] = json::object();
        cursor = &(*cursor)[parts[i]];
    }
    if (!cursor->is_object()) *cursor = json::object();
    (*cursor)[parts.back()] = value;
}

void HandleFirebaseSseFrame(const std::string& frame) {
    std::istringstream input(frame);
    std::string line, eventName = "message", dataText;
    while (std::getline(input, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.rfind("event:", 0) == 0) {
            eventName = line.substr(6);
            while (!eventName.empty() && eventName.front() == ' ') eventName.erase(eventName.begin());
        } else if (line.rfind("data:", 0) == 0) {
            std::string part = line.substr(5);
            if (!part.empty() && part.front() == ' ') part.erase(part.begin());
            if (!dataText.empty()) dataText += "\n";
            dataText += part;
        }
    }
    if (eventName == "cancel" || eventName == "auth_revoked") {
        authed = false;
        g_StopSyncThread = true;
        std::lock_guard<std::mutex> lock(g_ProfileMutex);
        g_CurrentUser.status = "access_revoked";
        return;
    }
    if (eventName != "put" && eventName != "patch") return;
    try {
        const json envelope = json::parse(dataText);
        if (!envelope.contains("data")) return;
        const std::string path = envelope.value("path", std::string("/"));
        const json data = envelope["data"];
        json profile;
        {
            std::lock_guard<std::mutex> lock(g_ProfileCacheMutex);
            if (path.empty() || path == "/") {
                if (eventName == "put") g_CppProfileCache = data;
                else if (data.is_object()) {
                    if (!g_CppProfileCache.is_object()) g_CppProfileCache = json::object();
                    for (auto it = data.begin(); it != data.end(); ++it) g_CppProfileCache[it.key()] = it.value();
                }
            } else {
                SetJsonAtPath(g_CppProfileCache, path, data);
            }
            profile = g_CppProfileCache;
        }
        if (profile.is_object() && !profile.empty()) UpdateCurrentUserFromProfile(profile);
    } catch (...) {
        // Ignore a malformed/partial event and keep the last known profile; next SSE event will resync.
    }
}

size_t FirebaseSseWriteCallback(char* contents, size_t size, size_t nmemb, void* userp) {
    const size_t bytes = size * nmemb;
    if (g_StopSyncThread.load()) return 0;
    auto* context = static_cast<SseContext*>(userp);
    if (!context || !contents || bytes == 0) return bytes;
    context->buffer.append(contents, bytes);
    while (true) {
        const size_t lf = context->buffer.find("\n\n");
        const size_t crlf = context->buffer.find("\r\n\r\n");
        size_t split = std::string::npos, delimiterSize = 0;
        if (lf != std::string::npos && (crlf == std::string::npos || lf < crlf)) { split = lf; delimiterSize = 2; }
        else if (crlf != std::string::npos) { split = crlf; delimiterSize = 4; }
        if (split == std::string::npos) break;
        const std::string frame = context->buffer.substr(0, split);
        context->buffer.erase(0, split + delimiterSize);
        HandleFirebaseSseFrame(frame);
        if (g_StopSyncThread.load()) return 0;
    }
    // Defend against unbounded buffer growth if a malformed server response arrives.
    if (context->buffer.size() > 1024 * 1024) context->buffer.clear();
    return bytes;
}

int FirebaseSseProgressCallback(void*, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
    return g_StopSyncThread.load() ? 1 : 0;
}

bool RunFirebaseProfileStream(const std::string& uid, const std::string& idToken, long& httpCode) {
    std::call_once(g_CurlInitFlag, []() { curl_global_init(CURL_GLOBAL_DEFAULT); });
    CURL* curl = curl_easy_init();
    if (!curl) return false;
    SseContext context;
    context.uid = uid;
    curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Accept: text/event-stream");
    headers = curl_slist_append(headers, "Cache-Control: no-cache");
    const std::string url = DATABASE_URL + "/cppProfiles/" + uid + ".json?auth=" + UrlEncode(idToken);
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, FirebaseSseWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &context);
    curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, FirebaseSseProgressCallback);
    curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 5000L);
    // Rotate the auth token and send a server-verified session heartbeat after each bounded stream window.
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 15000L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    const CURLcode result = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return result == CURLE_OK || result == CURLE_OPERATION_TIMEDOUT || (g_StopSyncThread.load() && result == CURLE_WRITE_ERROR);
}

void RealtimeSyncLoop() {
    unsigned int retrySeconds = 1;
    while (!g_StopSyncThread.load() && authed.load()) {
        std::string uid;
        uint64_t tokenExpiresAt;
        {
            std::lock_guard<std::mutex> lock(g_AuthMutex);
            uid = g_CppUid;
            tokenExpiresAt = g_FirebaseTokenExpiresAtMs;
        }
        if (uid.empty()) break;
        const uint64_t nowMs = static_cast<uint64_t>(std::time(nullptr)) * 1000ULL;
        if (tokenExpiresAt <= nowMs + 120000ULL && !RefreshFirebaseIdToken()) {
            authed = false;
            break;
        }
        const std::string token = GetFirebaseIdToken();
        long streamCode = 0;
        RunFirebaseProfileStream(uid, token, streamCode);
        if (g_StopSyncThread.load() || !authed.load()) break;
        if (streamCode == 401 || streamCode == 403) {
            if (!RefreshFirebaseIdToken()) { authed = false; break; }
        }
        std::string heartbeatResponse;
        long heartbeatCode = 0;
        const bool heartbeatOk = ServerRequest("/api/cpp/heartbeat", json::object(), heartbeatResponse, &heartbeatCode);
        if (!heartbeatOk && (heartbeatCode == 401 || heartbeatCode == 403 || heartbeatCode == 409)) {
            // Account was disabled/expired or this session was replaced: fail closed.
            authed = false;
            g_StopSyncThread = true;
            std::lock_guard<std::mutex> lock(g_ProfileMutex);
            g_CurrentUser.status = "access_revoked";
            break;
        }
        if (heartbeatOk) retrySeconds = 1;
        else {
            for (unsigned int i = 0; i < retrySeconds * 4 && !g_StopSyncThread.load(); ++i)
                std::this_thread::sleep_for(std::chrono::milliseconds(250));
            retrySeconds = (std::min)(8U, retrySeconds * 2U); // Parentheses prevent a Windows min macro from expanding here.
        }
    }
}
} // namespace

void StopRealtimeSyncThread() {
    g_StopSyncThread = true;
    std::lock_guard<std::mutex> lock(g_SyncThreadMutex);
    if (g_RealtimeSyncWorker.joinable() && g_RealtimeSyncWorker.get_id() != std::this_thread::get_id()) {
        g_RealtimeSyncWorker.join();
    }
}

void StartRealtimeSyncThread() {
    StopRealtimeSyncThread();
    g_StopSyncThread = false;
    std::lock_guard<std::mutex> lock(g_SyncThreadMutex);
    g_RealtimeSyncWorker = std::thread(RealtimeSyncLoop);
}

void LogoutCppSession() {
    const bool hadSession = authed.load();
    if (hadSession) {
        std::string response;
        long status = 0;
        ServerRequest("/api/cpp/logout", json::object(), response, &status);
    }
    authed = false;
    StopRealtimeSyncThread();
    {
        std::lock_guard<std::mutex> lock(g_AuthMutex);
        g_CppUid.clear();
        g_FirebaseIdToken.clear();
        g_FirebaseRefreshToken.clear();
        g_AppSessionId.clear();
        g_FirebaseTokenExpiresAtMs = 0;
    }
}

// ==========================================
// 4. Login & Authentication Logic
// ==========================================

namespace {
bool CompleteCppSessionLogin(const json& responseJson, std::string& err) {
    authed = false;
    StopRealtimeSyncThread();
    {
        std::lock_guard<std::mutex> lock(g_AuthMutex);
        g_FirebaseIdToken.clear();
        g_FirebaseRefreshToken.clear();
        g_FirebaseTokenExpiresAtMs = 0;
        g_CppUid.clear();
        g_AppSessionId.clear();
    }
    const std::string customToken = responseJson.value("customToken", std::string());
    const std::string uid = responseJson.value("uid", std::string());
    const std::string sessionId = responseJson.value("sessionId", std::string());
    if (customToken.empty() || uid.empty() || !responseJson.contains("profile")) {
        err = "Login bridge returned an incomplete session response.";
        return false;
    }
    {
        std::lock_guard<std::mutex> lock(g_AuthMutex);
        g_CppUid = uid;
        g_AppSessionId = sessionId;
    }
    {
        std::lock_guard<std::mutex> lock(g_ProfileCacheMutex);
        g_CppProfileCache = responseJson["profile"];
    }
    if (!ExchangeCustomTokenForFirebaseToken(customToken, err)) {
        std::lock_guard<std::mutex> lock(g_AuthMutex);
        g_CppUid.clear();
        g_AppSessionId.clear();
        return false;
    }
    UpdateCurrentUserFromProfile(responseJson["profile"]);
    if (!responseJson["profile"].value("accessRevoked", false)) authed = true;
    if (!authed.load()) {
        err = "This account is inactive or expired.";
        return false;
    }
    StartRealtimeSyncThread();
    return true;
}

bool RequestCppLogin(const std::string& endpoint, const json& payload, std::string& err) {
    std::string response;
    long status = 0;
    const bool ok = PerformHTTPRequestEx(CPP_API_BASE_URL + endpoint, "POST", payload.dump(), response,
        "", "application/json", 10000, &status);
    json data;
    try { data = json::parse(response); } catch (...) {}
    if (!ok) {
        if (data.is_object() && data.contains("message")) err = data.value("message", std::string("Login failed."));
        else if (status == 0) err = "Could not connect to RKBACKLES server. Check CPP_API_BASE_URL and network.";
        else err = "Login failed (HTTP " + std::to_string(status) + ").";
        return false;
    }
    if (!CompleteCppSessionLogin(data, err)) return false;
    return true;
}
} // namespace

bool NormalUserLogin(const std::string& username, const std::string& password, std::string& err) {
    const std::string normalizedUsername = username;
    if (normalizedUsername.empty() || password.empty()) {
        err = "Username or password cannot be empty!";
        return false;
    }
    json payload = {
        {"username", normalizedUsername},
        {"password", password},
        {"hwid", GetSystemHWID()}
    };
    if (!RequestCppLogin("/api/cpp/login", payload, err)) return false;
    SendLogToFirebase("LOGIN_SUCCESS", GetCurrentUserSnapshot().username, "User app login completed; account credentials are not included in logs.");
    return true;
}

bool DeveloperKeyLogin(const std::string& devKey, std::string& err) {
    if (devKey.empty()) {
        err = "Developer key cannot be empty!";
        return false;
    }
    json payload = { {"key", devKey}, {"hwid", GetSystemHWID()} };
    if (!RequestCppLogin("/api/cpp/key-login", payload, err)) return false;
    SendLogToFirebase("LOGIN_SUCCESS", GetCurrentUserSnapshot().username, "One-time key session started; key value is not included in logs.");
    return true;
}
