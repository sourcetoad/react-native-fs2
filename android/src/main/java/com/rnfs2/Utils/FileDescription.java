package com.rnfs2.Utils;

public class FileDescription {
  public String name;
  public String parentFolder;
  public String mimeType;

  public FileDescription(String n, String mT, String pF) {
    name = n;
    parentFolder = pF != null ? pF : "";
    mimeType = mT;
  }

  public String getFullPath() {
    return parentFolder + "/" + MimeType.getFullFileName(name, mimeType);
  }
}
