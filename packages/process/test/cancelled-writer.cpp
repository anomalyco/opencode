#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <cstdio>
#include <string>
#include <vector>

// An asynchronous descendant write can disappear after the capture peeks at it.
// Delays vary the fixture's cancellation timing, not the capture's completion policy.
int wmain(int argc, wchar_t** argv) {
  if (argc == 5) {
    const auto root = static_cast<DWORD>(wcstoul(argv[2], nullptr, 10));
    HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, root);
    const auto name = L"Local\\ProcessCaptureQueued-" + std::to_wstring(root);
    HANDLE ready = OpenEventW(EVENT_MODIFY_STATE, FALSE, name.c_str());
    if (!process || !ready) return 2;
    OVERLAPPED write{};
    write.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    std::vector<char> bytes(64 * 1024 * 1024, 'a');
    DWORD count = 0;
    const auto pipe = GetStdHandle(STD_OUTPUT_HANDLE);
    const bool immediate = WriteFile(pipe, bytes.data(), static_cast<DWORD>(bytes.size()), nullptr, &write);
    const auto started = immediate ? 0 : GetLastError();
    SetEvent(ready);
    WaitForSingleObject(process, 10000);
    Sleep(static_cast<DWORD>(wcstoul(argv[3], nullptr, 10)));
    CancelIoEx(pipe, &write);
    const bool complete = GetOverlappedResult(pipe, &write, &count, TRUE);
    const auto result = complete ? 0 : GetLastError();
    char report[128];
    const auto length = std::snprintf(report, sizeof(report), "{\"pid\":%lu,\"started\":%lu,\"result\":%lu}", GetCurrentProcessId(), started, result);
    HANDLE file = CreateFileW(argv[4], GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 3;
    WriteFile(file, report, static_cast<DWORD>(length), &count, nullptr);
    CloseHandle(file);
    CloseHandle(write.hEvent);
    CloseHandle(ready);
    CloseHandle(process);
    // Keep the writer open after cancellation. Successful capture must not
    // depend on this fallback exit; the test explicitly cleans up this process.
    Sleep(10000);
    return 0;
  }
  if (argc != 3) return 4;
  OVERLAPPED write{};
  write.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  DWORD count;
  const auto stdoutHandle = GetStdHandle(STD_OUTPUT_HANDLE);
  if (!WriteFile(stdoutHandle, "ROOT\n", 5, nullptr, &write) && GetLastError() != ERROR_IO_PENDING) return 5;
  if (!GetOverlappedResult(stdoutHandle, &write, &count, TRUE)) return 6;
  CloseHandle(write.hEvent);
  const auto name = L"Local\\ProcessCaptureQueued-" + std::to_wstring(GetCurrentProcessId());
  HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, name.c_str());
  wchar_t executable[32768];
  GetModuleFileNameW(nullptr, executable, 32768);
  std::wstring command = L"\"" + std::wstring(executable) + L"\" writer " +
    std::to_wstring(GetCurrentProcessId()) + L" " + argv[1] + L" \"" + argv[2] + L"\"";
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = stdoutHandle;
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION child{};
  if (!CreateProcessW(executable, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
      nullptr, nullptr, &startup, &child)) return 7;
  const auto status = WaitForSingleObject(ready, 10000);
  if (status != WAIT_OBJECT_0) TerminateProcess(child.hProcess, 1);
  CloseHandle(child.hThread);
  CloseHandle(child.hProcess);
  CloseHandle(ready);
  return status == WAIT_OBJECT_0 ? 0 : 8;
}
