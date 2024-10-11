package com.rnfs2;

public class RNFSFileTransformer {
  public interface FileTransformer {
    public byte[] onWriteFile(byte[] data);
    public byte[] onReadFile(byte[] data);
  }

  public static RNFSFileTransformer.FileTransformer sharedFileTransformer;
}
