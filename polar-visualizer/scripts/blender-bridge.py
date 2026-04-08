#!/usr/bin/env python3
"""
Blender MCP bridge — persistent socket connection to Blender addon.
Usage: python3 blender-bridge.py <command_json>
       python3 blender-bridge.py get_scene_info
       python3 blender-bridge.py execute_code '{"code": "import bpy; ..."}'
"""
import socket, json, sys, time

WIN_IP = "172.27.224.1"
PORT = 9880
TIMEOUT = 30

def send_command(cmd_type, params=None):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(TIMEOUT)
    s.connect((WIN_IP, PORT))
    
    msg = json.dumps({"type": cmd_type, "params": params or {}})
    s.sendall(msg.encode("utf-8"))
    
    # Read response — Blender schedules execution via timer,
    # so we need to wait for the response
    data = b""
    s.settimeout(TIMEOUT)
    while True:
        try:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
            # Check if we have valid JSON
            try:
                json.loads(data.decode("utf-8"))
                break  # Complete JSON received
            except json.JSONDecodeError:
                continue  # Partial, keep reading
        except socket.timeout:
            break
    
    s.close()
    
    if data:
        return json.loads(data.decode("utf-8"))
    return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: blender-bridge.py <command_type> [params_json]")
        sys.exit(1)
    
    cmd = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    
    result = send_command(cmd, params)
    print(json.dumps(result, indent=2))
