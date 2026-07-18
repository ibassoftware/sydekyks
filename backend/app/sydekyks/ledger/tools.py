"""Ledger's LLM-callable tools.

Empty for v1: Ledger's pipeline is a deterministic sequence of playbook steps, not agentic
tool-calling where the model chooses what to invoke. This file exists for convention consistency
 -  a future agentic Sydekyk would populate its own tools.py and call `register_tool(...)` here,
requiring no changes to the core Mission engine.
"""

# from app.services.missions import Tool, register_tool
#
# register_tool(Tool(name="...", description="...", parameters={...}, handler=...))
