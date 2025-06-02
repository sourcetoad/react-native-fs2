#include <jni.h>
#include "fs2OnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::fs2::initialize(vm);
}
