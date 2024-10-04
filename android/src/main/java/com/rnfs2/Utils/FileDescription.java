package com.rnfs2.Utils;

public class FileDescription {
  public String name;
  public String partentFolder;
  public String mimeType;

  public FileDescription(String n, String mT, String pF) {
    name = n;
    partentFolder = pF != null ? pF : "";
    mimeType = mT;
  }

  public String getFullPath(){
    return partentFolder + "/" + MimeType.getFullFileName(name, mimeType);
  }
}
