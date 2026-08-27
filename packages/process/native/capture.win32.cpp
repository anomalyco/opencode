#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <node_api.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstring>
#include <deque>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Only the documented Node-API ABI is loaded from the host executable.
#define NODE_APIS(X) \
  X(napi_get_cb_info) X(napi_get_undefined) X(napi_get_null) X(napi_typeof) \
  X(napi_get_value_string_utf16) X(napi_get_value_bool) X(napi_get_array_length) \
  X(napi_get_element) X(napi_get_named_property) X(napi_has_named_property) \
  X(napi_get_all_property_names) X(napi_get_property) X(napi_strict_equals) \
  X(napi_create_object) X(napi_create_function) X(napi_set_named_property) \
  X(napi_create_uint32) X(napi_create_string_utf8) X(napi_create_error) \
  X(napi_throw_error) X(napi_is_exception_pending) X(napi_create_promise) \
  X(napi_resolve_deferred) X(napi_reject_deferred) X(napi_create_arraybuffer) \
  X(napi_create_typedarray) X(napi_wrap) X(napi_unwrap) \
  X(napi_create_reference) X(napi_delete_reference) \
  X(napi_create_threadsafe_function) X(napi_call_threadsafe_function) \
  X(napi_release_threadsafe_function) X(napi_add_env_cleanup_hook) \
  X(napi_remove_env_cleanup_hook)

static struct {
#define DECLARE(name) decltype(&::name) name = nullptr;
  NODE_APIS(DECLARE)
#undef DECLARE
} api;
static std::once_flag apiOnce;
static const char* missingAPI = nullptr;

static void check(napi_status status) {
  if (status != napi_ok)
    throw std::runtime_error("Node-API operation failed: " + std::to_string(status));
}

struct WindowsError : std::runtime_error {
  DWORD code;
  WindowsError(const char* operation, DWORD code = GetLastError())
      : std::runtime_error(std::string(operation) + " failed (Win32 " + std::to_string(code) + ")"), code(code) {}
};

static napi_value reportException(napi_env env, const std::exception& error) {
  bool pending = false;
  if (api.napi_is_exception_pending(env, &pending) != napi_ok || pending) return nullptr;
  const auto status = api.napi_throw_error(env, dynamic_cast<const WindowsError*>(&error) ? "EWIN32" : "EINVAL", error.what());
  if (status != napi_ok) return nullptr;
  return nullptr;
}

static napi_value undefined(napi_env env) {
  napi_value value;
  check(api.napi_get_undefined(env, &value));
  return value;
}

static napi_value property(napi_env env, napi_value object, const char* name) {
  napi_value value;
  check(api.napi_get_named_property(env, object, name, &value));
  return value;
}

static bool hasProperty(napi_env env, napi_value object, const char* name) {
  bool present;
  check(api.napi_has_named_property(env, object, name, &present));
  return present;
}

static void requireRecord(napi_env env, napi_value value) {
  napi_valuetype type;
  check(api.napi_typeof(env, value, &type));
  napi_value null;
  check(api.napi_get_null(env, &null));
  bool isNull;
  check(api.napi_strict_equals(env, value, null, &isNull));
  if (type != napi_object || isNull) throw std::runtime_error("Expected an input record");
}

static std::wstring wideString(napi_env env, napi_value value) {
  size_t length;
  check(api.napi_get_value_string_utf16(env, value, nullptr, 0, &length));
  std::vector<char16_t> buffer(length + 1);
  check(api.napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length));
  std::wstring result(buffer.begin(), buffer.begin() + length);
  if (result.find(L'\0') != std::wstring::npos) throw std::runtime_error("Strings must not contain NUL");
  return result;
}

static std::wstring quoteArgument(const std::wstring& argument) {
  if (!argument.empty() && argument.find_first_of(L" \t\"") == std::wstring::npos) return argument;
  // MS CRT escaping, also used by libuv: double backslashes before a quote
  // (including the closing quote), and escape embedded quotes themselves.
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (auto character : argument) {
    if (character == L'\\') {
      ++slashes;
      continue;
    }
    result.append(slashes * (character == L'"' ? 2 : 1), L'\\');
    slashes = 0;
    if (character == L'"') result += L'\\';
    result += character;
  }
  result.append(slashes * 2, L'\\');
  result += L'"';
  return result;
}

struct Input {
  std::wstring executable;
  std::wstring command;
  std::wstring cwd;
  std::vector<wchar_t> environment;
  bool overlapped;

  Input(napi_env env, napi_value value) {
    requireRecord(env, value);
    executable = wideString(env, property(env, value, "executable"));
    const bool drive = executable.size() >= 3 &&
      ((executable[0] >= L'A' && executable[0] <= L'Z') || (executable[0] >= L'a' && executable[0] <= L'z')) &&
      executable[1] == L':' && (executable[2] == L'\\' || executable[2] == L'/');
    const bool unc = executable.size() > 2 && executable[0] == L'\\' && executable[1] == L'\\';
    if ((!drive && !unc) || executable.size() < 4 ||
        CompareStringOrdinal(executable.c_str() + executable.size() - 4, 4, L".exe", 4, TRUE) != CSTR_EQUAL)
      throw std::runtime_error("executable must be an absolute Windows .exe path");
    command = quoteArgument(executable);
    const auto args = property(env, value, "args");
    uint32_t length;
    check(api.napi_get_array_length(env, args, &length));
    for (uint32_t i = 0; i < length; ++i) {
      napi_value argument;
      check(api.napi_get_element(env, args, i, &argument));
      command += L' ' + quoteArgument(wideString(env, argument));
    }
    if (command.size() >= 32767) throw std::runtime_error("Windows command line exceeds 32767 UTF-16 code units");
    check(api.napi_get_value_bool(env, property(env, value, "overlapped"), &overlapped));
    if (hasProperty(env, value, "cwd")) {
      cwd = wideString(env, property(env, value, "cwd"));
      if (cwd.empty()) throw std::runtime_error("cwd must not be empty");
    }
    if (!hasProperty(env, value, "env")) return;
    const auto variables = property(env, value, "env");
    requireRecord(env, variables);
    napi_value keys;
    check(api.napi_get_all_property_names(env, variables, napi_key_own_only,
      static_cast<napi_key_filter>(napi_key_enumerable | napi_key_skip_symbols), napi_key_numbers_to_strings, &keys));
    check(api.napi_get_array_length(env, keys, &length));
    std::vector<std::pair<std::wstring, std::wstring>> entries;
    for (uint32_t i = 0; i < length; ++i) {
      napi_value key, entry;
      check(api.napi_get_element(env, keys, i, &key));
      auto name = wideString(env, key);
      if (name.empty() || name.find(L'=') != std::wstring::npos)
        throw std::runtime_error("Environment names must be nonempty and must not contain '='");
      check(api.napi_get_property(env, variables, key, &entry));
      entries.emplace_back(std::move(name), wideString(env, entry));
    }
    // Match Node's case-sensitive key sort before its case-insensitive dedup.
    std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    const auto compareNames = [](const auto& a, const auto& b) {
      return CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(), static_cast<int>(b.size()), TRUE);
    };
    std::stable_sort(entries.begin(), entries.end(), [&](const auto& a, const auto& b) {
      return compareNames(a.first, b.first) == CSTR_LESS_THAN;
    });
    entries.erase(std::unique(entries.begin(), entries.end(), [&](const auto& a, const auto& b) {
      return compareNames(a.first, b.first) == CSTR_EQUAL;
    }), entries.end());
    // libuv v1.51.0 src/win/process.c required_vars: an explicit empty value
    // wins; only missing names are taken from a single parent-env snapshot.
    const std::array<const wchar_t*, 11> required = {L"HOMEDRIVE", L"HOMEPATH", L"LOGONSERVER", L"PATH",
      L"SYSTEMDRIVE", L"SYSTEMROOT", L"TEMP", L"USERDOMAIN", L"USERNAME", L"USERPROFILE", L"WINDIR"};
    struct EnvironmentSnapshot {
      wchar_t* value = GetEnvironmentStringsW();
      ~EnvironmentSnapshot() { if (value) FreeEnvironmentStringsW(value); }
    } parent;
    if (!parent.value) throw WindowsError("GetEnvironmentStringsW");
    for (auto name : required) {
      if (std::any_of(entries.begin(), entries.end(), [&](const auto& entry) {
        return compareNames(entry.first, std::wstring(name)) == CSTR_EQUAL;
      })) continue;
      for (auto entry = parent.value; *entry; entry += wcslen(entry) + 1) {
        const auto equal = wcschr(entry, L'=');
        if (!equal || CompareStringOrdinal(entry, static_cast<int>(equal - entry), name, -1, TRUE) != CSTR_EQUAL) continue;
        entries.emplace_back(name, equal + 1);
        break;
      }
    }
    std::sort(entries.begin(), entries.end(), [&](const auto& a, const auto& b) {
      return compareNames(a.first, b.first) == CSTR_LESS_THAN;
    });
    for (const auto& entry : entries) {
      environment.insert(environment.end(), entry.first.begin(), entry.first.end());
      environment.push_back(L'=');
      environment.insert(environment.end(), entry.second.begin(), entry.second.end());
      environment.push_back(L'\0');
    }
    if (environment.empty()) environment.push_back(L'\0');
    environment.push_back(L'\0');
  }
};

struct Handle {
  HANDLE value = nullptr;
  Handle() = default;
  explicit Handle(HANDLE value) : value(value) {}
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : value(std::exchange(other.value, nullptr)) {}
  ~Handle() { reset(); }
  explicit operator bool() const { return value && value != INVALID_HANDLE_VALUE; }
  void reset(HANDLE next = nullptr) {
    if (*this) CloseHandle(value);
    value = next;
  }
};

struct Process;
struct Wait {
  PTP_WAIT value = nullptr;
  ~Wait() { close(); }
  void initialize(Process* owner);
  void arm(HANDLE handle) { SetThreadpoolWait(value, handle, nullptr); }
  void join() {
    if (!value) return;
    SetThreadpoolWait(value, nullptr, nullptr);
    WaitForThreadpoolWaitCallbacks(value, TRUE);
  }
  void close() {
    if (!value) return;
    join();
    CloseThreadpoolWait(value);
    value = nullptr;
  }
};

struct Reader {
  enum class Phase { Open, Reading, Ended };
  Process* owner = nullptr;
  Handle pipe;
  Handle event;
  Wait wait;
  OVERLAPPED operation{};
  std::array<char, 65536> buffer;
  std::deque<std::vector<char>> chunks;
  napi_deferred request = nullptr;
  Phase phase = Phase::Open;
  DWORD failure = ERROR_SUCCESS;

  Handle createPipe(bool overlapped);
  void beginRead(DWORD size, bool notify);
  bool completeRead(bool block, bool cancelled = false);
  void finishAtRootExit();
  void pump();
  void settleRead();
  void stop();
  void finish(DWORD code = ERROR_SUCCESS) {
    failure = code;
    phase = Phase::Ended;
    wait.close();
    pipe.reset();
    event.reset();
  }
};

struct Process {
  napi_env env;
  // Construction, wrapper, cleanup hook, and TSFN each own a separate reference.
  // Only the JS thread changes ownership; pool callbacks only notify the TSFN.
  unsigned owners = 1;
  bool cleanupAttached = false;
  bool environmentClosing = false;
  napi_ref wrapper = nullptr;
  napi_threadsafe_function dispatch = nullptr;
  std::atomic<bool> notificationsStopped{false};
  Handle process;
  Wait exitWait;
  Reader readers[2];
  napi_deferred exited = nullptr;
  DWORD exitCode = 0;
  DWORD exitFailure = 0;

  explicit Process(napi_env env) : env(env) { readers[0].owner = this; readers[1].owner = this; }
  void retain() { ++owners; }
  void release() { if (--owners == 0) delete this; }
  void spawn(Input& input);
  void observeExit();
  void settleExit();
  void terminateRoot();
  void stopNative();
  void releaseNotifications();
  void detachCleanup() {
    if (!cleanupAttached) return;
    check(api.napi_remove_env_cleanup_hook(env, cleanupEnvironment, this));
    cleanupAttached = false;
    release();
  }

  static void CALLBACK notify(PTP_CALLBACK_INSTANCE, void* context, PTP_WAIT, TP_WAIT_RESULT) {
    auto* self = static_cast<Process*>(context);
    if (self->notificationsStopped.load()) return;
    const auto status = api.napi_call_threadsafe_function(self->dispatch, nullptr, napi_tsfn_nonblocking);
    // One queued notification is sufficient: dispatch polls all three handles.
    if (status != napi_ok && status != napi_queue_full) self->notificationsStopped.store(true);
  }

  static void dispatchReady(napi_env env, napi_value, void* context, void*) {
    auto* self = static_cast<Process*>(context);
    if (!env || self->environmentClosing || self->notificationsStopped.load()) return;
    try {
      self->observeExit();
      for (auto& reader : self->readers) reader.pump();
      self->settleExit();
      if (!self->process) self->releaseNotifications();
    } catch (const std::exception& error) {
      self->stopNative();
      self->releaseNotifications();
      reportException(env, error);
    }
  }

  static void finalizeDispatch(napi_env, void* data, void*) {
    auto* self = static_cast<Process*>(data);
    // Environment shutdown can finalize a TSFN independently of its wrapper.
    self->stopNative();
    self->dispatch = nullptr;
    self->release();
  }

  static void cleanupEnvironment(void* data) {
    auto* self = static_cast<Process*>(data);
    self->environmentClosing = true;
    self->stopNative();
    self->releaseNotifications();
    self->cleanupAttached = false;
    self->release();
  }

  static void finalizeWrapper(napi_env, void* data, void*) {
    auto* self = static_cast<Process*>(data);
    self->stopNative();
    self->releaseNotifications();
    // Removing a registered synchronous hook does not execute JavaScript.
    if (self->cleanupAttached && api.napi_remove_env_cleanup_hook(self->env, cleanupEnvironment, self) == napi_ok) {
      self->cleanupAttached = false;
      self->release();
    }
    self->release();
  }
};

void Wait::initialize(Process* owner) {
  value = CreateThreadpoolWait(Process::notify, owner, nullptr);
  if (!value) throw WindowsError("CreateThreadpoolWait");
}

Handle Reader::createPipe(bool overlapped) {
  static std::atomic<unsigned long long> sequence{0};
  const auto name = L"\\\\.\\pipe\\opencode-process-capture-" + std::to_wstring(GetCurrentProcessId()) +
    L"-" + std::to_wstring(sequence.fetch_add(1));
  pipe.reset(CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 65536, 65536, 0, nullptr));
  if (!pipe) throw WindowsError("CreateNamedPipeW");
  event.reset(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  if (!event) throw WindowsError("CreateEventW");
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  Handle child(CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, &security, OPEN_EXISTING,
    overlapped ? FILE_FLAG_OVERLAPPED : 0, nullptr));
  if (!child) throw WindowsError("CreateFileW(pipe)");
  operation.hEvent = event.value;
  if (!ConnectNamedPipe(pipe.value, &operation)) {
    const auto code = GetLastError();
    if (code == ERROR_IO_PENDING) {
      DWORD bytes;
      if (!GetOverlappedResult(pipe.value, &operation, &bytes, TRUE)) throw WindowsError("ConnectNamedPipe");
    } else if (code != ERROR_PIPE_CONNECTED) {
      throw WindowsError("ConnectNamedPipe", code);
    }
  }
  wait.initialize(owner);
  return child;
}

void Reader::beginRead(DWORD size, bool notify) {
  if (!ResetEvent(event.value)) throw WindowsError("ResetEvent");
  operation = {};
  operation.hEvent = event.value;
  phase = Phase::Reading;
  if (ReadFile(pipe.value, buffer.data(), size, nullptr, &operation)) {
    completeRead(true);
    return;
  }
  const auto code = GetLastError();
  if (code != ERROR_IO_PENDING) {
    finish(code == ERROR_BROKEN_PIPE || code == ERROR_PIPE_NOT_CONNECTED || (!notify && code == ERROR_NO_DATA) ? ERROR_SUCCESS : code);
    return;
  }
  if (notify) wait.arm(event.value);
}

bool Reader::completeRead(bool block, bool cancelled) {
  if (phase != Phase::Reading) return true;
  DWORD bytes = 0;
  const bool success = GetOverlappedResult(pipe.value, &operation, &bytes, block);
  const auto code = success ? ERROR_SUCCESS : GetLastError();
  if (code == ERROR_IO_INCOMPLETE) return false;
  wait.join();
  phase = Phase::Open;
  if (success) {
    // A successful read racing cancellation belongs to the captured output.
    if (bytes) chunks.emplace_back(buffer.begin(), buffer.begin() + bytes);
    return true;
  }
  if (cancelled && code == ERROR_OPERATION_ABORTED) return true;
  finish(code == ERROR_BROKEN_PIPE || code == ERROR_PIPE_NOT_CONNECTED ? ERROR_SUCCESS : code);
  return true;
}

void Reader::finishAtRootExit() {
  if (phase == Phase::Ended) return;
  if (phase == Phase::Reading) {
    CancelIoEx(pipe.value, &operation);
    completeRead(true, true);
  }
  if (phase == Phase::Ended) return;
  // A descendant can cancel a queued write after PeekNamedPipe. Only the
  // parent's read handle becomes nonblocking; the child's handle is unchanged.
  DWORD mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
  if (!SetNamedPipeHandleState(pipe.value, &mode, nullptr, nullptr)) {
    finish(GetLastError());
    return;
  }
  DWORD remaining = 0;
  if (!PeekNamedPipe(pipe.value, nullptr, 0, nullptr, &remaining, nullptr)) {
    const auto code = GetLastError();
    finish(code == ERROR_BROKEN_PIPE || code == ERROR_PIPE_NOT_CONNECTED ? ERROR_SUCCESS : code);
    return;
  }
  // This is a per-stream, reconciled cutoff, not an atomic OS-exit snapshot.
  // Own the fixed tail in memory so inherited writers cannot delay EOF.
  while (remaining && phase != Phase::Ended) {
    const auto before = chunks.size();
    beginRead(std::min<DWORD>(static_cast<DWORD>(buffer.size()), remaining), false);
    completeRead(true);
    if (chunks.size() != before) remaining -= static_cast<DWORD>(chunks.back().size());
  }
  if (phase != Phase::Ended) finish();
}

static napi_value readError(napi_env env, DWORD code) {
  napi_value name, message, error;
  check(api.napi_create_string_utf8(env, code == ERROR_OPERATION_ABORTED ? "ECANCELED" : "EIO", NAPI_AUTO_LENGTH, &name));
  const auto text = "Capture read failed (Win32 " + std::to_string(code) + ")";
  check(api.napi_create_string_utf8(env, text.c_str(), text.size(), &message));
  check(api.napi_create_error(env, name, message, &error));
  return error;
}

void Reader::settleRead() {
  if (!request || owner->environmentClosing) return;
  if (!chunks.empty()) {
    napi_value storage, value;
    void* data;
    check(api.napi_create_arraybuffer(owner->env, chunks.front().size(), &data, &storage));
    std::memcpy(data, chunks.front().data(), chunks.front().size());
    check(api.napi_create_typedarray(owner->env, napi_uint8_array, chunks.front().size(), storage, 0, &value));
    const auto deferred = std::exchange(request, nullptr);
    chunks.pop_front();
    // Promise resolution can call a user-defined `then` getter synchronously.
    // Commit ownership before it can re-enter close() or another read.
    check(api.napi_resolve_deferred(owner->env, deferred, value));
    return;
  }
  if (phase != Phase::Ended) return;
  if (failure) {
    const auto error = readError(owner->env, failure);
    const auto deferred = std::exchange(request, nullptr);
    check(api.napi_reject_deferred(owner->env, deferred, error));
    return;
  }
  napi_value value;
  check(api.napi_get_null(owner->env, &value));
  const auto deferred = std::exchange(request, nullptr);
  check(api.napi_resolve_deferred(owner->env, deferred, value));
}

void Reader::pump() {
  if (phase == Phase::Reading && !completeRead(false)) return;
  while (request && chunks.empty() && phase == Phase::Open) {
    beginRead(static_cast<DWORD>(buffer.size()), true);
    if (phase == Phase::Reading) return;
  }
  settleRead();
}

void Reader::stop() {
  if (phase == Phase::Reading) {
    CancelIoEx(pipe.value, &operation);
    DWORD ignored;
    GetOverlappedResult(pipe.value, &operation, &ignored, TRUE);
  }
  wait.close();
  pipe.reset();
  event.reset();
  if (phase != Phase::Ended) failure = ERROR_OPERATION_ABORTED;
  phase = Phase::Ended;
}

void Process::spawn(Input& input) {
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  Handle stdinHandle(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
    &security, OPEN_EXISTING, 0, nullptr));
  if (!stdinHandle) throw WindowsError("CreateFileW(NUL)");
  auto stdoutHandle = readers[0].createPipe(input.overlapped);
  auto stderrHandle = readers[1].createPipe(input.overlapped);
  HANDLE inherited[] = {stdinHandle.value, stdoutHandle.value, stderrHandle.value};
  SIZE_T size = 0;
  if (InitializeProcThreadAttributeList(nullptr, 1, 0, &size) || GetLastError() != ERROR_INSUFFICIENT_BUFFER)
    throw WindowsError("InitializeProcThreadAttributeList(size)");
  std::vector<unsigned char> storage(size);
  auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &size)) throw WindowsError("InitializeProcThreadAttributeList");
  struct AttributeCleanup {
    LPPROC_THREAD_ATTRIBUTE_LIST value;
    ~AttributeCleanup() { DeleteProcThreadAttributeList(value); }
  } cleanup{attributes};
  if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), nullptr, nullptr))
    throw WindowsError("UpdateProcThreadAttribute");
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  startup.StartupInfo.wShowWindow = SW_HIDE;
  startup.StartupInfo.hStdInput = inherited[0];
  startup.StartupInfo.hStdOutput = inherited[1];
  startup.StartupInfo.hStdError = inherited[2];
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION info{};
  if (!CreateProcessW(input.executable.c_str(), input.command.data(), nullptr, nullptr, TRUE,
      CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
      input.environment.empty() ? nullptr : input.environment.data(), input.cwd.empty() ? nullptr : input.cwd.c_str(),
      &startup.StartupInfo, &info)) throw WindowsError("CreateProcessW");
  process.reset(info.hProcess);
  Handle thread(info.hThread);
  exitWait.initialize(this);
  exitWait.arm(process.value);
}

void Process::observeExit() {
  if (!process) return;
  const auto status = WaitForSingleObject(process.value, 0);
  if (status == WAIT_TIMEOUT) return;
  if (status != WAIT_OBJECT_0) throw WindowsError("WaitForSingleObject(process)");
  exitWait.close();
  if (!GetExitCodeProcess(process.value, &exitCode)) exitFailure = GetLastError();
  process.reset();
  for (auto& reader : readers) reader.finishAtRootExit();
}

void Process::settleExit() {
  if (process || !exited || environmentClosing) return;
  if (exitFailure) {
    check(api.napi_reject_deferred(env, exited, readError(env, exitFailure)));
    exited = nullptr;
    return;
  }
  napi_value value;
  check(api.napi_create_uint32(env, exitCode, &value));
  check(api.napi_resolve_deferred(env, exited, value));
  exited = nullptr;
}

void Process::terminateRoot() {
  if (!process || WaitForSingleObject(process.value, 0) == WAIT_OBJECT_0) return;
  if (TerminateProcess(process.value, 1)) return;
  const auto code = GetLastError();
  if (WaitForSingleObject(process.value, 0) == WAIT_OBJECT_0) return;
  throw WindowsError("TerminateProcess", code);
}

void Process::stopNative() {
  notificationsStopped.store(true);
  // Join every pool callback before releasing notification ownership. There
  // are no host loop handles or async cleanup hooks to outlive an environment.
  exitWait.close();
  for (auto& reader : readers) reader.stop();
  if (!process) return;
  if (WaitForSingleObject(process.value, 0) != WAIT_OBJECT_0) {
    if (TerminateProcess(process.value, 1)) WaitForSingleObject(process.value, INFINITE);
    else {
      const auto code = GetLastError();
      if (WaitForSingleObject(process.value, 0) != WAIT_OBJECT_0) exitFailure = code;
    }
  }
  if (!GetExitCodeProcess(process.value, &exitCode)) exitFailure = GetLastError();
  process.reset();
}

void Process::releaseNotifications() {
  // Retain the wrapper while native work is live, including when callers keep
  // only its exit promise. Unread cutoff chunks need only the caller's wrapper.
  if (wrapper && api.napi_delete_reference(env, wrapper) == napi_ok) wrapper = nullptr;
  if (!dispatch) return;
  notificationsStopped.store(true);
  exitWait.close();
  for (auto& reader : readers) reader.wait.close();
  const auto callback = std::exchange(dispatch, nullptr);
  const auto status = api.napi_release_threadsafe_function(callback, napi_tsfn_abort);
  if (status != napi_ok && status != napi_closing) exitFailure = ERROR_INVALID_FUNCTION;
}

static Process* receiver(napi_env env, napi_callback_info info) {
  napi_value object;
  size_t count = 0;
  check(api.napi_get_cb_info(env, info, &count, nullptr, &object, nullptr));
  void* data;
  check(api.napi_unwrap(env, object, &data));
  if (!data) throw std::runtime_error("Invalid capture receiver");
  return static_cast<Process*>(data);
}

template<unsigned channel>
static napi_value readStream(napi_env env, napi_callback_info info) {
  try {
    auto* self = receiver(env, info);
    auto& reader = self->readers[channel];
    if (reader.request) throw std::runtime_error("A read is already pending on this stream");
    napi_value promise;
    napi_deferred request;
    check(api.napi_create_promise(env, &request, &promise));
    reader.request = request;
    self->observeExit();
    for (auto& stream : self->readers) stream.pump();
    self->settleExit();
    if (!self->process) self->releaseNotifications();
    return promise;
  } catch (const std::exception& error) {
    return reportException(env, error);
  }
}

static napi_value terminate(napi_env env, napi_callback_info info) {
  try {
    receiver(env, info)->terminateRoot();
    return undefined(env);
  } catch (const std::exception& error) {
    return reportException(env, error);
  }
}

static napi_value close(napi_env env, napi_callback_info info) {
  try {
    auto* self = receiver(env, info);
    self->stopNative();
    self->releaseNotifications();
    for (auto& reader : self->readers) {
      reader.chunks.clear();
      reader.failure = ERROR_OPERATION_ABORTED;
      reader.settleRead();
    }
    self->settleExit();
    return undefined(env);
  } catch (const std::exception& error) {
    return reportException(env, error);
  }
}

static napi_value start(napi_env env, napi_callback_info info) {
  Process* self = nullptr;
  try {
    size_t count = 1;
    napi_value argument;
    check(api.napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr));
    if (count != 1) throw std::runtime_error("Expected one capture input record");
    Input input(env, argument);
    self = new Process(env);
    napi_value name;
    check(api.napi_create_string_utf8(env, "Process capture", NAPI_AUTO_LENGTH, &name));
    napi_threadsafe_function dispatch;
    check(api.napi_create_threadsafe_function(env, nullptr, nullptr, name, 1, 1, self,
      Process::finalizeDispatch, self, Process::dispatchReady, &dispatch));
    self->dispatch = dispatch;
    self->retain();
    check(api.napi_add_env_cleanup_hook(env, Process::cleanupEnvironment, self));
    self->cleanupAttached = true;
    self->retain();
    self->spawn(input);
    napi_value object, value;
    check(api.napi_create_object(env, &object));
    const auto pid = GetProcessId(self->process.value);
    if (!pid) throw WindowsError("GetProcessId");
    check(api.napi_create_uint32(env, pid, &value));
    check(api.napi_set_named_property(env, object, "pid", value));
    napi_deferred exited;
    check(api.napi_create_promise(env, &exited, &value));
    self->exited = exited;
    check(api.napi_set_named_property(env, object, "exited", value));
    const std::pair<const char*, napi_callback> methods[] = {
      {"readStdout", readStream<0>}, {"readStderr", readStream<1>}, {"terminate", terminate}, {"close", close}
    };
    for (const auto& method : methods) {
      check(api.napi_create_function(env, method.first, NAPI_AUTO_LENGTH, method.second, nullptr, &value));
      check(api.napi_set_named_property(env, object, method.first, value));
    }
    check(api.napi_wrap(env, object, self, Process::finalizeWrapper, nullptr, nullptr));
    self->retain();
    napi_ref wrapper;
    check(api.napi_create_reference(env, object, 1, &wrapper));
    self->wrapper = wrapper;
    self->release();
    return object;
  } catch (const std::exception& error) {
    if (self) {
      self->stopNative();
      self->releaseNotifications();
      try { self->detachCleanup(); } catch (...) { /* The registered hook retains its ownership on failure. */ }
      self->release();
    }
    return reportException(env, error);
  }
}

NAPI_MODULE_INIT() {
  std::call_once(apiOnce, [] {
    const auto module = GetModuleHandleW(nullptr);
#define LOAD(name) \
    api.name = reinterpret_cast<decltype(api.name)>(GetProcAddress(module, #name)); \
    if (!api.name && !missingAPI) missingAPI = #name;
    NODE_APIS(LOAD)
#undef LOAD
  });
  try {
    if (missingAPI) throw std::runtime_error(std::string("Host does not export required Node-API symbol: ") + missingAPI);
    napi_value function;
    check(api.napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, nullptr, &function));
    check(api.napi_set_named_property(env, exports, "start", function));
    return exports;
  } catch (const std::exception& error) {
    if (!api.napi_throw_error || !api.napi_is_exception_pending) return nullptr;
    return reportException(env, error);
  }
}
