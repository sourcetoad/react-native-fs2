package com.rnfs2.Utils;

public class MediaStoreQuery {
  public String uri;
  public String fileName;
  public String relativePath;
  public String mediaType;

  public MediaStoreQuery(String contentURI, String contentFileName, String contentRelativePath, String contentMediaType) {
    uri = contentURI != null ? contentURI : "";
    fileName = contentFileName != null ? contentFileName : "";
    relativePath = contentRelativePath != null ? contentRelativePath : "";
    mediaType = contentMediaType;
  }
}
