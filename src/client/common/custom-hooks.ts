import { SOCKET_MSG_TAG_API, Snippet } from "../../lib/interface";
import { useState, useEffect } from "react";
import sc from './socket-client'

export function useSnippets() {
  const [snippets, setSnippets] = useState([])

  useEffect(() => {
    sc.emit(SOCKET_MSG_TAG_API.SP_GET, (sps: Snippet[]) => {
      setSnippets(sps)
    })
    sc.on(SOCKET_MSG_TAG_API.SP_UPDATE, (sps: Snippet[]) => {
      setSnippets(sps)
    })
    return () => {
      sc.off(SOCKET_MSG_TAG_API.SP_UPDATE)
    }
  }, [])

  return snippets
}