#include <jni.h>
#include <fbjni/fbjni.h>
#include "fs2OnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    margelo::nitro::fs2::registerAllNatives();
  });
}
