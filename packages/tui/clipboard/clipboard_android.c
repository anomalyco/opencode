// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build android

#include <android/log.h>
#include <jni.h>
#include <stdlib.h>
#include <string.h>

#define LOG_FATAL(...) __android_log_print(ANDROID_LOG_FATAL, \
    "GOLANG.DESIGN/X/CLIPBOARD", __VA_ARGS__)

static jmethodID find_method(JNIEnv *env, jclass clazz, const char *name, const char *sig) {
	jmethodID m = (*env)->GetMethodID(env, clazz, name, sig);
	if (m == 0) {
		(*env)->ExceptionClear(env);
		LOG_FATAL("cannot find method %s %s", name, sig);
		return 0;
	}
	return m;
}

jobject get_clipboard(uintptr_t jni_env, uintptr_t ctx) {
	JNIEnv *env = (JNIEnv*)jni_env;
	jclass ctxClass = (*env)->GetObjectClass(env, (jobject)ctx);
	jmethodID getSystemService = find_method(env, ctxClass, "getSystemService", "(Ljava/lang/String;)Ljava/lang/Object;");

	jstring service = (*env)->NewStringUTF(env, "clipboard");
	jobject ret = (jobject)(*env)->CallObjectMethod(env, (jobject)ctx, getSystemService, service);
	jthrowable err = (*env)->ExceptionOccurred(env);

	if (err != NULL) {
		LOG_FATAL("cannot find clipboard");
		(*env)->ExceptionClear(env);
		return NULL;
	}
	return ret;
}

char *clipboard_read_string(uintptr_t java_vm, uintptr_t jni_env, uintptr_t ctx) {
	JNIEnv *env = (JNIEnv*)jni_env;
	jobject mgr = get_clipboard(jni_env, ctx);
	if (mgr == NULL) {
		return NULL;
	}

	jclass mgrClass = (*env)->GetObjectClass(env, mgr);
	jmethodID getText = find_method(env, mgrClass, "getText", "()Ljava/lang/CharSequence;");

	jobject content = (jstring)(*env)->CallObjectMethod(env, mgr, getText);
	if (content == NULL) {
		return NULL;
	}

	jclass clzCharSequence = (*env)->GetObjectClass(env, content);
	jmethodID toString = (*env)->GetMethodID(env, clzCharSequence, "toString", "()Ljava/lang/String;");
	jobject s = (*env)->CallObjectMethod(env, content, toString);

	const char *chars = (*env)->GetStringUTFChars(env, s, NULL);
	char *copy = strdup(chars);
	(*env)->ReleaseStringUTFChars(env, s, chars);
	return copy;
}

void clipboard_write_string(uintptr_t java_vm, uintptr_t jni_env, uintptr_t ctx, char *str) {
	JNIEnv *env = (JNIEnv*)jni_env;
	jobject mgr = get_clipboard(jni_env, ctx);
	if (mgr == NULL) {
		return;
	}

	jclass mgrClass = (*env)->GetObjectClass(env, mgr);
	jmethodID setText = find_method(env, mgrClass, "setText", "(Ljava/lang/CharSequence;)V");

	(*env)->CallVoidMethod(env, mgr, setText, (*env)->NewStringUTF(env, str));
}
