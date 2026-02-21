import { create } from "@bufbuild/protobuf"
import { Pty } from "@/pty"
import {
  PtyInfoSchema,
  ListPtyResponseSchema,
  DeletePtyResponseSchema,
  type ListPtyRequest,
  type CreatePtyRequest,
  type GetPtyRequest,
  type UpdatePtyRequest,
  type DeletePtyRequest,
} from "../gen/opencode/v1/pty_pb"

function toProtoPtyInfo(info: Pty.Info) {
  return create(PtyInfoSchema, {
    id: info.id,
    shell: info.command,
    cwd: info.cwd,
    pid: BigInt(info.pid),
    created: BigInt(Date.now()),
    updated: BigInt(Date.now()),
  })
}

export const pty = {
  async list(_req: ListPtyRequest) {
    const ptys = Pty.list()
    return create(ListPtyResponseSchema, {
      ptys: ptys.map(toProtoPtyInfo),
    })
  },

  async create(req: CreatePtyRequest) {
    const input: Pty.CreateInput = {
      command: req.shell,
      cwd: req.cwd,
    }
    if (req.env) {
      input.env = Object.fromEntries(Object.entries(req.env).map(([k, v]) => [k, String(v)]))
    }
    const info = await Pty.create(input)
    return toProtoPtyInfo(info)
  },

  async get(req: GetPtyRequest) {
    const info = Pty.get(req.ptyId)
    if (!info) {
      throw new Error(`PTY not found: ${req.ptyId}`)
    }
    return toProtoPtyInfo(info)
  },

  async update(req: UpdatePtyRequest) {
    const info = Pty.get(req.ptyId)
    if (!info) {
      throw new Error(`PTY not found: ${req.ptyId}`)
    }

    const input: Pty.UpdateInput = {}

    if (req.shell !== undefined) {
      throw new Error("Cannot update shell after creation")
    }

    if (req.cwd !== undefined) {
      throw new Error("Cannot update cwd after creation")
    }

    if (Object.keys(input).length === 0) {
      return toProtoPtyInfo(info)
    }

    const updated = await Pty.update(req.ptyId, input)
    if (!updated) {
      throw new Error(`PTY not found: ${req.ptyId}`)
    }
    return toProtoPtyInfo(updated)
  },

  async delete(req: DeletePtyRequest) {
    await Pty.remove(req.ptyId)
    return create(DeletePtyResponseSchema, {
      success: true,
    })
  },
}
