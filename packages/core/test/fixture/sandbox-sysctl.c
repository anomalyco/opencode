// Test sysctl by numeric MIB as well as name; never print queried process data.
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>
#include <sys/wait.h>
#include <unistd.h>

static int read_query(const char *name, int *mib, unsigned int count, const char *marker) {
    size_t size = 0;
    if ((count ? sysctl(mib, count, NULL, &size, NULL, 0) : sysctlbyname(name, NULL, &size, NULL, 0)) != 0) {
        fprintf(stderr, "query denied: %d\n", errno);
        return 1;
    }
    if (!marker) {
        puts("query allowed");
        return 0;
    }
    char *bytes = malloc(size);
    if (!bytes)
        return 70;
    if (sysctl(mib, count, bytes, &size, NULL, 0) != 0) {
        fprintf(stderr, "query denied: %d\n", errno);
        free(bytes);
        return 1;
    }
    size_t length = strlen(marker);
    int found = 0;
    for (size_t i = 0; i + length <= size; i++) {
        if (memcmp(bytes + i, marker, length) == 0)
            found = 1;
    }
    free(bytes);
    puts(found ? "marker visible" : "marker absent");
    return found ? 0 : 2;
}

int main(int argc, char **argv) {
    if (argc < 2)
        return 64;
    if (strcmp(argv[1], "hold") == 0) {
        if (!getenv("PRIVATE_PROCESS_CANARY"))
            return 65;
        signal(SIGUSR1, SIG_IGN);
        puts("ready");
        fflush(stdout);
        getchar();
        return 0;
    }
    if (strcmp(argv[1], "rename") == 0) {
        char name[] = "oc-runtime-probe";
        if (sysctlbyname("kern.procname", NULL, NULL, name, sizeof(name)) != 0) {
            fprintf(stderr, "query denied: %d\n", errno);
            return 1;
        }
        puts("query allowed");
        return 0;
    }
    if (strcmp(argv[1], "child") == 0 && argc == 3) {
        int gate[2];
        if (pipe(gate) != 0)
            return 70;
        pid_t child = fork();
        if (child < 0)
            return 70;
        if (child == 0) {
            close(gate[1]);
            char byte;
            read(gate[0], &byte, 1);
            _exit(0);
        }
        close(gate[0]);
        int target[] = {CTL_KERN, KERN_PROCARGS2, child};
        int result = read_query(NULL, target, 3, argv[2]);
        if (kill(child, SIGTERM) != 0)
            result = 1;
        close(gate[1]);
        waitpid(child, NULL, 0);
        return result;
    }
    if (strcmp(argv[1], "signal") == 0 && argc == 3) {
        if (kill(atoi(argv[2]), SIGUSR1) != 0) {
            fprintf(stderr, "query denied: %d\n", errno);
            return 1;
        }
        puts("query allowed");
        return 0;
    }
    if (strcmp(argv[1], "metadata") == 0 && argc == 4) {
        int target[CTL_MAXNAME];
        size_t target_count = CTL_MAXNAME - 2;
        if (sysctlnametomib(argv[3], target + 2, &target_count) != 0) {
            fprintf(stderr, "target lookup failed: %d\n", errno);
            return 1;
        }
        target[0] = 0;
        target[1] = atoi(argv[2]);
        char buffer[4096];
        size_t size = sizeof(buffer);
        if (sysctl(target, (unsigned int)target_count + 2, buffer, &size, NULL, 0) != 0) {
            fprintf(stderr, "query denied: %d\n", errno);
            return 1;
        }
        puts("query allowed");
        return 0;
    }
    int mib[4];
    unsigned int count = 0;
    if (strcmp(argv[1], "procargs") == 0 && argc == 4) {
        mib[0] = CTL_KERN;
        mib[1] = KERN_PROCARGS2;
        mib[2] = strcmp(argv[2], "self") == 0 ? getpid() : atoi(argv[2]);
        count = 3;
    } else if (strcmp(argv[1], "processes") == 0) {
        mib[0] = CTL_KERN;
        mib[1] = KERN_PROC;
        mib[2] = KERN_PROC_ALL;
        mib[3] = 0;
        count = 4;
    }
    return read_query(argv[1], mib, count, argc == 4 ? argv[3] : NULL);
}
